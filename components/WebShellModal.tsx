'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Modal, Input, Button, Upload, message, Typography, Steps } from 'antd';
import { UploadOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const { Text } = Typography;

interface WebShellModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WebShellModal({ open, onClose }: WebShellModalProps) {
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [username, setUsername] = useState('');
  const [privateKeyStr, setPrivateKeyStr] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [authToken, setAuthToken] = useState('');

  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      setStep(0);
      setPassword('');
      setUsername('');
      setPrivateKeyStr('');
      setAuthToken('');
      if (socketRef.current) socketRef.current.disconnect();
      if (termInstance.current) {
        resizeCleanupRef.current?.();
        resizeCleanupRef.current = null;
        termInstance.current.dispose();
      }
      termInstance.current = null;
      socketRef.current = null;
    }
  }, [open]);

  const verifyPassword = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch('/api/webshell/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok) {
        setAuthToken(data.token);
        setStep(1);
      } else {
        message.error('Invalid password');
      }
    } catch {
      message.error('Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const startTerminal = () => {
    if (!username || !privateKeyStr) {
      message.error('Username and Private Key are required');
      return;
    }
    setStep(2);
    setIsConnecting(true);
  };

  // Initialize terminal when step reaches 2
  useEffect(() => {
    if (step !== 2 || !terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#1e1e1e' }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('init', { username, privateKey: privateKeyStr, token: authToken });
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
      if (fitAddonRef.current) fitAddonRef.current.fit();
      if (socketRef.current && termInstance.current) {
        socketRef.current.emit('resize', {
          cols: termInstance.current.cols,
          rows: termInstance.current.rows
        });
      }
    };

    window.addEventListener('resize', handleResize);
    resizeCleanupRef.current = () => window.removeEventListener('resize', handleResize);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleKeyUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setPrivateKeyStr(e.target?.result as string);
    };
    reader.readAsText(file);
    return false; // Prevent default upload behavior
  };

  return (
    <Modal
      title="Local WebShell (SSH)"
      open={open}
      onCancel={onClose}
      footer={null}
      width={step === 2 ? 900 : 500}
      destroyOnClose
    >
      <div className="mb-4">
        <Steps current={step} size="small" items={[
          { title: 'Auth' },
          { title: 'Config' },
          { title: 'Terminal' }
        ]} />
      </div>

      {step === 0 && (
        <div className="py-4 space-y-4">
          <Text type="secondary">Enter the WebShell password to continue.</Text>
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onPressEnter={verifyPassword}
          />
          <Button type="primary" block loading={isVerifying} onClick={verifyPassword}>
            Verify
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="py-4 space-y-4">
          <div>
            <Text strong>SSH Username</Text>
            <Input
              prefix={<UserOutlined />}
              placeholder="e.g., root, ubuntu"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Text strong>Private Key (Client Side)</Text>
            <p className="text-xs text-slate-500 mb-2">
              Please select your private key (e.g., <code>~/.ssh/id_rsa</code> or <code>~/.ssh/id_ed25519</code>).
              The key is only kept in memory and never saved to disk.
            </p>
            <Upload beforeUpload={handleKeyUpload} maxCount={1} showUploadList={{ showRemoveIcon: true }}>
              <Button icon={<UploadOutlined />}>Select Private Key</Button>
            </Upload>
            {privateKeyStr && <Text type="success" className="block mt-2 text-xs">✓ Key loaded into memory</Text>}
          </div>
          <Button type="primary" block onClick={startTerminal} disabled={!username || !privateKeyStr}>
            Connect
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="bg-black p-2 rounded-lg" style={{ height: '500px' }}>
          {isConnecting && <div className="text-white text-xs mb-2">Connecting to localhost...</div>}
          <div ref={terminalRef} style={{ width: '100%', height: isConnecting ? 'calc(100% - 24px)' : '100%' }} />
        </div>
      )}
    </Modal>
  );
}
