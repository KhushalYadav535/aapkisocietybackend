require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
  const targetEmail = 'khushalyadav535@gmail.com';
  console.log(`\n======================================================`);
  console.log(`📧 Sending Test Email to: ${targetEmail}`);
  console.log(`📡 Host: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} (Secure: ${process.env.SMTP_SECURE})`);
  console.log(`👤 User: ${process.env.SMTP_USER}`);
  console.log(`======================================================\n`);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Verify connection configuration
  try {
    console.log('Verifying SMTP connection credentials...');
    await transporter.verify();
    console.log('✅ SMTP connection successfully established!\n');
  } catch (verifyErr) {
    console.error('❌ SMTP verification failed:', verifyErr.message);
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || '"AapkiSociety Platform" <service@aapkisociety.in>',
    to: targetEmail,
    subject: '🎉 Test Email - AapkiSociety System Notification',
    html: `
      <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:580px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">
        <div style="background:linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);padding:28px 24px;text-align:center;color:#ffffff;">
          <h1 style="margin:0;font-size:22px;font-weight:800;">AapkiSociety Test Email ✅</h1>
          <p style="margin:8px 0 0 0;font-size:13px;color:#e0e7ff;">Email delivery system is working successfully!</p>
        </div>

        <div style="padding:28px 24px;">
          <p style="font-size:15px;color:#1e293b;line-height:1.6;margin-top:0;">
            Hello Khushal,
          </p>
          <p style="font-size:14px;color:#475569;line-height:1.6;">
            Yeh test email AapkiSociety platform ki taraf se <strong>${targetEmail}</strong> par successfully send ho gaya hai. Hostinger SMTP credentials (<strong>${process.env.SMTP_USER}</strong>) successfully authenticate ho chuke hain.
          </p>

          <div style="background:#f1f5f9;border-left:4px solid #2563eb;padding:14px 16px;border-radius:8px;margin:20px 0;">
            <p style="margin:0;font-size:13px;color:#334155;font-weight:600;">System Details:</p>
            <p style="margin:4px 0 0 0;font-size:12px;color:#64748b;">
              • Sender: ${process.env.SMTP_USER}<br/>
              • Recipient: ${targetEmail}<br/>
              • Delivery Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST<br/>
              • Status: Verified & Dispatched
            </p>
          </div>

          <p style="font-size:13px;color:#64748b;margin-bottom:0;">
            Ab koi bhi demo book ya alerts aane par is email par notifications receive honge.
          </p>
        </div>

        <div style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
          © ${new Date().getFullYear()} AapkiSociety • Society Management Platform
        </div>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('🎉 EMAIL DELIVERED SUCCESSFULLY!');
    console.log('Message ID:', info.messageId);
    console.log('Accepted:', info.accepted);
    console.log(`\nEmail has been sent to: ${targetEmail}`);
  } catch (sendErr) {
    console.error('❌ Failed to send email:', sendErr.message);
  }
}

testEmail();
