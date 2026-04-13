export type SshAuthMode = 'privateKey' | 'password';

export interface WebShellAuditClientPayload {
  browserReportedIp?: string;
  userAgent?: string;
  language?: string;
  platform?: string;
  timezone?: string;
  screen?: string;
}

export interface WebShellInitPayload {
  token: string;
  username: string;
  authMode: SshAuthMode;
  privateKey?: string;
  password?: string;
  audit: WebShellAuditClientPayload;
}

export interface WebShellHandoffPayload {
  token: string;
  username: string;
  authMode: SshAuthMode;
}

export type WebShellAuditEventName =
  | 'auth_token_rejected'
  | 'ssh_connect_started'
  | 'ssh_connect_succeeded'
  | 'ssh_shell_started'
  | 'ssh_connect_failed'
  | 'ssh_disconnected';

export interface WebShellAuditEvent {
  timestamp: string;
  event: WebShellAuditEventName;
  sessionId: string;
  authMode?: SshAuthMode;
  sshUsername?: string;
  socketIp?: string;
  forwardedFor?: string;
  realIp?: string;
  browserReportedIp?: string;
  userAgent?: string;
  language?: string;
  platform?: string;
  timezone?: string;
  screen?: string;
  reason?: string;
}
