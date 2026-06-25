export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

/** Default transport: logs the email instead of sending. Works with no provider/key. */
class ConsoleEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `\n[email] (no provider configured)\n  to: ${message.to}\n  subject: ${message.subject}\n  ${message.text}\n`,
    );
    return Promise.resolve();
  }
}

/** Real transport via Resend's HTTP API, used when RESEND_API_KEY is set. */
class ResendEmailTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed (${res.status})`);
    }
  }
}

export function createEmailTransport(): EmailTransport {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new ResendEmailTransport(
      apiKey,
      process.env.EMAIL_FROM ?? 'Owe Well <noreply@owewell.aidenjang.com>',
    );
  }
  return new ConsoleEmailTransport();
}
