const nodemailer = require('nodemailer');
require('dotenv').config();

// In-memory OTP storage: email -> { otp, expiresAt, tempUserData }
const otpStore = new Map();

// Configure SMTP transporter
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
      auth: { user, pass }
    });
  }

  // Gmail shorthand if SMTP_GMAIL_USER & SMTP_GMAIL_PASS are provided
  if (process.env.SMTP_GMAIL_USER && process.env.SMTP_GMAIL_PASS) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_GMAIL_USER,
        pass: process.env.SMTP_GMAIL_PASS
      }
    });
  }

  return null;
}

const mailer = {
  // Generate and store OTP
  generateOTP(email, tempUserData) {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    otpStore.set(email.toLowerCase().trim(), {
      otp,
      expiresAt,
      tempUserData
    });

    return otp;
  },

  // Verify OTP
  verifyOTP(email, inputOtp) {
    const key = email.toLowerCase().trim();
    const record = otpStore.get(key);

    if (!record) {
      return { success: false, error: 'No verification code was requested for this email' };
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(key);
      return { success: false, error: 'Verification code has expired. Please request a new one.' };
    }

    if (record.otp !== inputOtp.trim()) {
      return { success: false, error: 'Invalid verification code. Please check your email and try again.' };
    }

    // OTP matched! Clean up and return stored user details
    const userData = record.tempUserData;
    otpStore.delete(key);
    return { success: true, userData };
  },

  // Send OTP Email
  async sendOTPEmail(email, otp, name = 'User') {
    const transporter = createTransporter();

    // HTML Email Template
    const htmlContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #0b0f19; color: #f9fafb; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #3b82f6; margin: 0; font-size: 24px;">GeoLive Pro</h2>
          <p style="color: #9ca3af; font-size: 14px; margin-top: 4px;">Account Email Verification</p>
        </div>
        
        <p style="font-size: 15px; line-height: 1.5; color: #e5e7eb;">Hello <strong>${name}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.5; color: #9ca3af;">
          Thank you for registering. Use the 6-digit verification code below to verify your email address and activate your live tracking account:
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #10b981; background: rgba(16, 185, 129, 0.1); border: 2px dashed #10b981; padding: 12px 28px; border-radius: 8px;">
            ${otp}
          </span>
        </div>

        <p style="font-size: 13px; color: #9ca3af; text-align: center;">
          This code is valid for <strong>10 minutes</strong>. If you did not request this registration, please ignore this email.
        </p>
        
        <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 24px; padding-top: 16px; text-align: center; font-size: 12px; color: #6b7280;">
          &copy; ${new Date().getFullYear()} GeoLive Pro Real-Time GPS Tracking System
        </div>
      </div>
    `;

    console.log(`\n======================================================`);
    console.log(`🔑 [EMAIL OTP VERIFICATION]`);
    console.log(`📧 Recipient: ${email}`);
    console.log(`🔢 6-Digit OTP Code: ${otp}`);
    console.log(`⏱️ Expiry: 10 minutes`);
    console.log(`======================================================\n`);

    if (transporter) {
      try {
        const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || process.env.SMTP_GMAIL_USER || 'no-reply@geolive.com';
        await transporter.sendMail({
          from: `"GeoLive Pro" <${fromAddress}>`,
          to: email,
          subject: `${otp} is your GeoLive verification code`,
          html: htmlContent
        });
        console.log(`✅ Real email successfully sent to ${email}`);
        return { success: true, mode: 'smtp' };
      } catch (err) {
        console.error(`⚠️ SMTP delivery error:`, err.message);
        return { success: true, mode: 'console_fallback', error: err.message, otp };
      }
    } else {
      console.log(`ℹ️ SMTP is not configured in .env yet. The OTP is shown above in console for instant testing.`);
      return { success: true, mode: 'dev_mode', otp };
    }
  }
};

module.exports = mailer;
