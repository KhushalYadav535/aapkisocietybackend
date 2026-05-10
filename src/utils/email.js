const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.EMAIL_FROM || 'noreply@aapkisociety.com';
const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:3000';

const sendEmail = async (to, subject, html) => {
  if (!process.env.SMTP_USER) {
    console.log(`[Email-Stub] To: ${to} | Subject: ${subject}`);
    return { messageId: 'stub', accepted: [to] };
  }
  return transporter.sendMail({ from: FROM, to, subject, html });
};

// ─── Templates ────────────────────────────────────────────────────────

const sendVerificationEmail = (to, token) =>
  sendEmail(to, 'Verify your AapkiSociety Registration', `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#1e40af">Welcome to AapkiSociety!</h2>
      <p>Please verify your email address to continue the onboarding process.</p>
      <a href="${PLATFORM_URL}/verify/${token}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;margin:16px 0">Verify Email</a>
      <p style="color:#6b7280;font-size:12px">If the button doesn't work, copy this link:<br/>${PLATFORM_URL}/verify/${token}</p>
    </div>`);

const sendWelcomeEmail = (to, societyName, schemaName) =>
  sendEmail(to, `Welcome to AapkiSociety – ${societyName}`, `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#059669">KYC Approved! 🎉</h2>
      <p>Congratulations! <strong>${societyName}</strong> has been approved and your workspace is ready.</p>
      <p>You can now log in and start configuring your society — add wings, flats, billing heads and invite members.</p>
      <a href="${PLATFORM_URL}/dashboard" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;margin:16px 0">Go to Dashboard</a>
    </div>`);

const sendKYCRejectionEmail = (to, societyName, reason, unlockDate) =>
  sendEmail(to, `AapkiSociety KYC Review – Action Required`, `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#dc2626">KYC Review Update</h2>
      <p>The KYC submission for <strong>${societyName}</strong> was not approved.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>You may re-apply after <strong>${new Date(unlockDate).toLocaleDateString('en-IN')}</strong>.</p>
    </div>`);

const sendRenewalReminderEmail = (to, societyName, plan, daysLeft, renewalDate) =>
  sendEmail(to, `Subscription Renewal Reminder – ${daysLeft} day${daysLeft > 1 ? 's' : ''} left`, `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#d97706">Renewal Reminder</h2>
      <p>The <strong>${plan}</strong> subscription for <strong>${societyName}</strong> renews on <strong>${renewalDate}</strong>.</p>
      <p>Please ensure payment is processed to avoid service interruption.</p>
      <a href="${PLATFORM_URL}/dashboard/billing" style="display:inline-block;padding:12px 24px;background:#d97706;color:#fff;text-decoration:none;border-radius:8px;margin:16px 0">View Billing</a>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
      <p style="color:#6b7280;font-size:11px">You are receiving this because you are an admin of ${societyName}. Statutory renewal notices cannot be opted out.</p>
    </div>`);

const sendReUploadRequestEmail = (to, societyName, remarks) =>
  sendEmail(to, `AapkiSociety – KYC Re-Upload Requested`, `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#d97706">KYC Documents Need Update</h2>
      <p>The platform admin has requested updated documents for <strong>${societyName}</strong>.</p>
      <p><strong>Remarks:</strong> ${remarks}</p>
      <a href="${PLATFORM_URL}/dashboard/societies" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;margin:16px 0">Re-Upload Documents</a>
    </div>`);

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendKYCRejectionEmail,
  sendRenewalReminderEmail,
  sendReUploadRequestEmail,
};
