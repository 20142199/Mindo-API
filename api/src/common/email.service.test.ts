import { describe, expect, it } from 'vitest';
import { EmailService, renderOtpEmail } from './email.service';

describe('renderOtpEmail', () => {
  it('renders the Mindo registration OTP', () => {
    const html = renderOtpEmail('123456', 'register', 10);
    expect(html).toContain('Mindo');
    expect(html).toContain('123456');
    expect(html).toContain('10 phút');
  });
});

describe('EmailService login alert', () => {
  it('escapes device metadata before rendering the email', async () => {
    const service = new EmailService();
    const sent: { html?: string }[] = [];
    (service as unknown as { transporter: { sendMail: (message: { html?: string }) => Promise<void> } }).transporter = {
      sendMail: async (message) => { sent.push(message); },
    };

    await service.sendLoginAlert('user@mindo.local', '<script>alert(1)</script>', '127.0.0.1');

    expect(sent[0].html).not.toContain('<script>');
    expect(sent[0].html).toContain('&lt;script&gt;');
  });
});
