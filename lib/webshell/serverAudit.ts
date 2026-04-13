import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Socket } from 'socket.io';
import type { SshAuthMode, WebShellAuditClientPayload, WebShellAuditEvent, WebShellInitPayload } from './types';

const WEBSHELL_AUDIT_DIR = path.join(os.homedir(), '.local', 'share', 'kanban', 'webshell');
const WEBSHELL_AUDIT_FILE = path.join(WEBSHELL_AUDIT_DIR, 'ssh-audit.jsonl');

export interface ValidatedWebShellInitPayload {
  token: string;
  username: string;
  authMode: SshAuthMode;
  privateKey?: string;
  password?: string;
  audit: WebShellAuditClientPayload;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function ensureWebShellAuditWritable(): string {
  fs.mkdirSync(WEBSHELL_AUDIT_DIR, { recursive: true });
  fs.accessSync(WEBSHELL_AUDIT_DIR, fs.constants.W_OK);

  if (!fs.existsSync(WEBSHELL_AUDIT_FILE)) {
    fs.appendFileSync(WEBSHELL_AUDIT_FILE, '');
  }

  fs.accessSync(WEBSHELL_AUDIT_FILE, fs.constants.W_OK);
  return WEBSHELL_AUDIT_FILE;
}

export function appendWebShellAuditEvent(event: WebShellAuditEvent) {
  const filePath = ensureWebShellAuditWritable();
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
}

export function createWebShellSessionId(): string {
  return randomUUID();
}

export function buildAuditContext(socket: Socket, audit: WebShellAuditClientPayload) {
  const forwardedForHeader = socket.handshake.headers['x-forwarded-for'];
  const realIpHeader = socket.handshake.headers['x-real-ip'];

  return {
    socketIp: socket.handshake.address,
    forwardedFor: Array.isArray(forwardedForHeader) ? forwardedForHeader.join(', ') : forwardedForHeader,
    realIp: Array.isArray(realIpHeader) ? realIpHeader.join(', ') : realIpHeader,
    ...audit,
  };
}

export function validateWebShellInitPayload(payload: unknown): ValidatedWebShellInitPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Partial<WebShellInitPayload>;
  if (!isNonEmptyString(data.token) || !isNonEmptyString(data.username)) {
    return null;
  }

  if (data.authMode === 'privateKey') {
    if (!isNonEmptyString(data.privateKey) || isNonEmptyString(data.password)) {
      return null;
    }

    return {
      token: data.token,
      username: data.username,
      authMode: 'privateKey',
      privateKey: data.privateKey,
      audit: data.audit ?? {},
    };
  }

  if (data.authMode === 'password') {
    if (!isNonEmptyString(data.password) || isNonEmptyString(data.privateKey)) {
      return null;
    }

    return {
      token: data.token,
      username: data.username,
      authMode: 'password',
      password: data.password,
      audit: data.audit ?? {},
    };
  }

  return null;
}
