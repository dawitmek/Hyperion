import { createTransport } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// Any SMTP service works (Resend, Postmark, Amazon SES, a mailbox's own SMTP), given as one URL.
export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = createTransport(smtpUrl);
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}

// At most one email of each kind per address every 2 minutes, however many requests ask for one: requests from many
// addresses can't flood someone's inbox, or use up the server's monthly sending allowance on one account.
export const EMAIL_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_TRACKED = 10_000;

export class EmailCooldown {
  private sent = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  // True, and starts the wait, when an email of this kind may go to this address now.
  take(kind: string, to: string) {
    const key = `${kind}:${to}`;
    const now = this.now();
    if ((this.sent.get(key) ?? 0) > now) return false;
    this.sent.set(key, now + EMAIL_COOLDOWN_MS);
    if (this.sent.size > MAX_TRACKED) {
      for (const [k, until] of this.sent) if (until <= now) this.sent.delete(k);
      for (const k of this.sent.keys()) {
        if (this.sent.size <= MAX_TRACKED) break;
        this.sent.delete(k);
      }
    }
    return true;
  }

  clear() {
    this.sent.clear();
  }
}
