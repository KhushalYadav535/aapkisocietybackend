const nodemailer = require('nodemailer');
const { normalizePhone } = require('./phone');

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

const sendDemoBookingNotificationEmail = async (booking) => {
  const recipients = process.env.DEMO_NOTIFICATION_EMAILS || 'khushalyadav535@gmail.com';
  const societyName = booking.societyName || booking.society_name || 'New Society';
  const city = booking.city || 'Not specified';
  const flatCount = booking.flatCount || booking.flat_count || 100;
  const name = booking.name || 'Lead';
  const phone = booking.phone || '';
  const email = booking.email || '';
  
  const phoneData = normalizePhone(phone);
  const waTarget = phoneData.waPhone || phone;
  const displayPhone = phoneData.display || phone;
  const telNumber = phoneData.clean || phone;
  const waLink = `https://wa.me/${waTarget}?text=${encodeURIComponent(`Hello ${name}! Thank you for requesting a demo of AapkiSociety for ${societyName}. When would be a good time for a quick 10-minute walkthrough?`)}`;

  const subject = `🎉 New Demo Walkthrough: ${societyName} (${flatCount} Flats, ${city}) - AapkiSociety`;

  const html = `
    <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
      <div style="background:linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);padding:28px 24px;text-align:center;color:#ffffff;">
        <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px;">🎉 New Demo Walkthrough Scheduled!</h1>
        <p style="margin:8px 0 0 0;font-size:13px;color:#e0e7ff;font-weight:500;">
          A prospective society committee member requested a 1-on-1 demo from the website.
        </p>
      </div>

      <div style="padding:28px 24px;">
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:11px 0;font-size:12px;font-weight:700;color:#64748b;width:38%;">Society Name</td>
            <td style="padding:11px 0;font-size:15px;font-weight:700;color:#0f172a;">${societyName}</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:11px 0;font-size:12px;font-weight:700;color:#64748b;">City / Region</td>
            <td style="padding:11px 0;font-size:14px;font-weight:600;color:#0f172a;">${city}</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:11px 0;font-size:12px;font-weight:700;color:#64748b;">Total Units / Flats</td>
            <td style="padding:11px 0;font-size:14px;font-weight:800;color:#4f46e5;">${flatCount} Flats</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:11px 0;font-size:12px;font-weight:700;color:#64748b;">Contact Person</td>
            <td style="padding:11px 0;font-size:14px;font-weight:700;color:#0f172a;">${name}</td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:11px 0;font-size:12px;font-weight:700;color:#64748b;">WhatsApp Phone</td>
            <td style="padding:11px 0;font-size:15px;font-weight:700;color:#059669;">
              <a href="tel:${telNumber}" style="color:#059669;text-decoration:none;">${displayPhone}</a>
            </td>
          </tr>
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:11px 0;font-size:12px;font-weight:700;color:#64748b;">Email Address</td>
            <td style="padding:11px 0;font-size:14px;font-weight:600;color:#0f172a;">
              ${email ? `<a href="mailto:${email}" style="color:#2563eb;text-decoration:none;">${email}</a>` : '<span style="color:#94a3b8;font-weight:normal;">Not provided</span>'}
            </td>
          </tr>
          <tr>
            <td style="padding:11px 0;font-size:12px;font-weight:700;color:#64748b;">Submission Time</td>
            <td style="padding:11px 0;font-size:13px;font-weight:600;color:#64748b;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td>
          </tr>
        </table>

        <!-- Direct WhatsApp Action Button -->
        <div style="text-align:center;margin:24px 0 12px 0;">
          <a href="${waLink}" target="_blank" style="display:inline-block;padding:14px 28px;background:#25D366;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;border-radius:12px;box-shadow:0 4px 12px rgba(37,211,102,0.3);">
            💬 Open WhatsApp Chat with ${name}
          </a>
        </div>
      </div>

      <div style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        Delivered automatically to <strong style="color:#0f172a;">${recipients}</strong>
      </div>
    </div>
  `;

  return sendEmail(recipients, subject, html);
};

const sendMfaOtpEmail = (to, otp, name = 'Valued Member') => {
  const subject = `🔐 Your AapkiSociety Verification Code: ${otp}`;
  const html = `
    <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:540px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      <div style="background:linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);padding:28px 24px;text-align:center;color:#ffffff;">
        <h1 style="margin:0;font-size:20px;font-weight:700;">🔐 Two-Step Verification (Email OTP)</h1>
        <p style="margin:6px 0 0 0;font-size:13px;color:#e0e7ff;">AapkiSociety Financial & Treasury Security</p>
      </div>
      <div style="padding:28px 24px;text-align:center;">
        <p style="font-size:14px;color:#334155;margin:0 0 16px 0;">Hello <strong>${name}</strong>,</p>
        <p style="font-size:14px;color:#475569;margin:0 0 20px 0;">Use the one-time verification code (OTP) below to authenticate your role and access the platform:</p>
        <div style="background:#f1f5f9;border:2px dashed #cbd5e1;border-radius:12px;padding:16px;margin:20px auto;max-width:240px;letter-spacing:8px;font-size:32px;font-weight:800;color:#1e293b;font-family:monospace;">
          ${otp}
        </div>
        <p style="font-size:12px;color:#64748b;margin:20px 0 0 0;">This OTP is valid for <strong>10 minutes</strong>. Never share this code with anyone.</p>
        <p style="font-size:11px;color:#94a3b8;margin:8px 0 0 0;">If you did not request this verification code, please contact your society administrator immediately.</p>
      </div>
      <div style="background:#f8fafc;padding:14px 20px;text-align:center;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">
        © AapkiSociety • Secure Housing Society Management Platform
      </div>
    </div>
  `;
  return sendEmail(to, subject, html);
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendKYCRejectionEmail,
  sendRenewalReminderEmail,
  sendReUploadRequestEmail,
  sendDemoBookingNotificationEmail,
  sendMfaOtpEmail,
};
