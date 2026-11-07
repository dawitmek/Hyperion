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
