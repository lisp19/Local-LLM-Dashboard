import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpired, issueToken } from '../../../../lib/webshell-tokens';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const pwdPath = path.join(process.cwd(), 'webshell-password.txt');

    if (!fs.existsSync(pwdPath)) {
      return NextResponse.json({ error: 'Password file not found' }, { status: 500 });
    }

    const correctPassword = fs.readFileSync(pwdPath, 'utf-8').trim();

    if (password !== correctPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const token = crypto.randomBytes(32).toString('hex');
    issueToken(token);
    cleanupExpired();

    return NextResponse.json({ success: true, token });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
