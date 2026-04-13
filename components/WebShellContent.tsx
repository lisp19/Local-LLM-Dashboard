'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Upload, message, Steps, Typography } from 'antd';
import { LockOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { collectBrowserAuditPayload } from '../lib/webshell/browserAudit';
import { createWebShellHandoff, listenForWebShellHandoffRequests, requestWebShellHandoff } from '../lib/webshell/handoff';
import type { SshAuthMode, WebShellInitPayload } from '../lib/webshell/types';

const { Text } = Typography;
const HIDDEN_CLICK_WINDOW_MS = 8000;

interface WebShellContentProps {
  mode: 'modal' | 'page';
  initialHandoffId?: string | null;
}

export default function WebShellContent({ mode, initialHandoffId }: WebShellContentProps) {
  const [step, setStep] = useState(0);
  const [webshellPassword, setWebshellPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [username, setUsername] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authMode, setAuthMode] = useState<SshAuthMode>('privateKey');
  const [privateKeyStr, setPrivateKeyStr] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const hiddenClickTimesRef = useRef<number[]>([]);

  useEffect(() => listenForWebShellHandoffRequests(), []);

  useEffect(() => {
    if (!initialHandoffId) {
      return;
    }

    let cancelled = false;
    requestWebShellHandoff(initialHandoffId).then((handoff) => {
      if (!handoff || cancelled) {
        return;
      }

      setAuthToken(handoff.token);
      setUsername(handoff.username);
      setAuthMode(handoff.authMode);
      setStep(1);
    });

    return () => {
      cancelled = true;
    };
  }, [initialHandoffId]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      resizeCleanupRef.current?.();
      termInstance.current?.dispose();
      fitAddonRef.current = null;
    };
  }, []);

  const canConnect = useMemo(() => {
    if (!username) {
      return false;
    }

    if (authMode === 'privateKey') {
      return Boolean(privateKeyStr);
    }

    return Boolean(sshPassword);
  }, [authMode, privateKeyStr, sshPassword, username]);

  const verifyPassword = async () => {
    if (!webshellPassword) {
      message.error('Password is required');
      return;
    }

    setIsVerifying(true);
    try {
      const res = await fetch('/api/webshell/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: webshellPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        message.error('Invalid password');
        return;
      }

      setAuthToken(data.token);
      setStep(1);
    } catch {
      message.error('Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const switchToPasswordMode = () => {
    setPrivateKeyStr('');
    setSshPassword('');
    setAuthMode('password');
    hiddenClickTimesRef.current = [];
    message.info('已切换为密码登录');
  };

  const switchToPrivateKeyMode = () => {
    setPrivateKeyStr('');
    setSshPassword('');
    setAuthMode('privateKey');
    hiddenClickTimesRef.current = [];
  };

  const recordHiddenClick = () => {
    const now = Date.now();
    hiddenClickTimesRef.current = hiddenClickTimesRef.current
      .filter((time) => now - time <= HIDDEN_CLICK_WINDOW_MS)
      .concat(now);

    if (hiddenClickTimesRef.current.length >= 5) {
      switchToPasswordMode();
    }
  };

  const handleConnect = () => {
    if (!username) {
      message.error('Username is required');
      return;
    }

    if (authMode === 'privateKey') {
      if (!privateKeyStr) {
        recordHiddenClick();
        return;
      }
    }

    if (authMode === 'password' && !sshPassword) {
      message.error('SSH password is required');
      return;
    }

    setStep(2);
    setIsConnecting(true);
  };

  const openInNewTab = () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!authToken || step === 0 || step === 2) {
      window.open('/webshell', '_blank', 'noopener,noreferrer');
      return;
    }

    const handoffId = createWebShellHandoff({
      token: authToken,
      username,
      authMode,
    });

    window.open(`/webshell?handoff=${encodeURIComponent(handoffId)}`, '_blank', 'noopener,noreferrer');
  };

  const handleKeyUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      setPrivateKeyStr((event.target?.result as string) || '');
      hiddenClickTimesRef.current = [];
    };
    reader.readAsText(file);
    return false;
  };

  useEffect(() => {
    if (step !== 2 || !terminalRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#1e1e1e' },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    const socket = io();
    socketRef.current = socket;

    socket.on('connect', async () => {
      const audit = await collectBrowserAuditPayload();
      const payload: WebShellInitPayload = {
        token: authToken,
        username,
        authMode,
        privateKey: authMode === 'privateKey' ? privateKeyStr : undefined,
        password: authMode === 'password' ? sshPassword : undefined,
        audit,
      };

      socket.emit('init', payload);
    });

    socket.on('ready', () => {
      setIsConnecting(false);
      term.focus();
    });

    socket.on('data', (data: string) => {
      term.write(data);
    });

    socket.on('error', (err: string) => {
      term.write(`\r\n\x1b[31m${err}\x1b[0m\r\n`);
      setIsConnecting(false);
    });

    socket.on('close', () => {
      term.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
    });

    term.onData((data) => {
      socket.emit('data', data);
    });

    const handleResize = () => {
      fitAddon.fit();
      socket.emit('resize', { cols: term.cols, rows: term.rows });
    };

    window.addEventListener('resize', handleResize);
    resizeCleanupRef.current = () => window.removeEventListener('resize', handleResize);

    return () => {
      socket.disconnect();
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
      term.dispose();
    };
  }, [authMode, authToken, privateKeyStr, sshPassword, step, username]);

  return (
    <div className={mode === 'page' ? 'mx-auto max-w-5xl p-6' : ''}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Text strong className="block">Local WebShell (SSH)</Text>
          <Text type="secondary" className="text-xs">
            {mode === 'page' ? '独立标签页终端' : '可在当前页面使用，也可弹出到新标签页'}
          </Text>
        </div>
        <Button onClick={openInNewTab}>
          {step === 2 ? '在新标签页重新打开' : '在新标签页打开'}
        </Button>
      </div>

      <div className="mb-4">
        <Steps
          current={step}
          size="small"
          items={[{ title: 'Auth' }, { title: 'Config' }, { title: 'Terminal' }]}
        />
      </div>

      {step === 0 && (
        <div className="space-y-4 py-4">
          <Text type="secondary">Enter the WebShell password to continue.</Text>
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Password"
            value={webshellPassword}
            onChange={(event) => setWebshellPassword(event.target.value)}
            onPressEnter={verifyPassword}
          />
          <Button type="primary" block loading={isVerifying} onClick={verifyPassword}>
            Verify
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 py-4">
          <div>
            <Text strong>SSH Username</Text>
            <Input
              prefix={<UserOutlined />}
              placeholder="e.g., root, ubuntu"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1"
            />
          </div>

          {authMode === 'privateKey' && (
            <div>
              <Text strong>Private Key (Client Side)</Text>
              <p className="mb-2 text-xs text-slate-500">
                Please select your private key (e.g., <code>~/.ssh/id_rsa</code> or <code>~/.ssh/id_ed25519</code>).
                The key is only kept in memory and never saved to disk.
              </p>
              <Upload beforeUpload={handleKeyUpload} maxCount={1} showUploadList={{ showRemoveIcon: true }}>
                <Button icon={<UploadOutlined />}>Select Private Key</Button>
              </Upload>
              {privateKeyStr && (
                <Text type="success" className="mt-2 block text-xs">
                  ✓ Key loaded into memory
                </Text>
              )}
            </div>
          )}

          {authMode === 'password' && (
            <div>
              <Text strong>SSH Password</Text>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="SSH password"
                value={sshPassword}
                onChange={(event) => setSshPassword(event.target.value)}
                className="mt-1"
              />
              <Button type="link" className="px-0" onClick={switchToPrivateKeyMode}>
                改用私钥登录
              </Button>
            </div>
          )}

          <Button
            type="primary"
            block
            onClick={handleConnect}
            aria-disabled={!canConnect}
            className={!canConnect ? 'opacity-60' : ''}
          >
            Connect
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-lg bg-black p-2" style={{ height: mode === 'page' ? 'calc(100vh - 220px)' : '500px' }}>
          {isConnecting && <div className="mb-2 text-xs text-white">Connecting to localhost...</div>}
          <div ref={terminalRef} style={{ width: '100%', height: isConnecting ? 'calc(100% - 24px)' : '100%' }} />
        </div>
      )}
    </div>
  );
}
