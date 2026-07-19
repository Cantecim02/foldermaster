import nodemailer from "nodemailer";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

let transporter;

export function isSupportMailConfigured() {
  if (config.smtpJsonTransport) return true;
  return Boolean(
    config.smtpHost &&
    config.smtpFrom &&
    config.smtpUser &&
    config.smtpPass
  );
}

export async function sendSupportRequest({
  fullName,
  email,
  subject,
  description,
  attachment,
  requestId
}) {
  if (!isSupportMailConfigured()) {
    throw new HttpError(503, "Support email service is temporarily unavailable.", {
      code: "SUPPORT_UNAVAILABLE",
      expose: true
    });
  }

  const safeSubject = singleLine(subject);
  const safeName = singleLine(fullName);
  const text = [
    "Editio support request",
    `Request ID: ${requestId}`,
    `Name: ${safeName}`,
    `Email: ${email}`,
    `Subject: ${safeSubject}`,
    "",
    "Description:",
    description,
    "",
    `Attachment: ${attachment?.filename || "None"}`
  ].join("\n");

  const attachments = attachment
    ? [{
        filename: attachment.filename,
        content: attachment.buffer,
        contentType: attachment.mimeType
      }]
    : [];

  try {
    const result = await getTransporter().sendMail({
      from: config.smtpFrom || "Editio Support <editioapp@gmail.com>",
      to: config.supportRecipientEmail,
      replyTo: email,
      subject: `[Editio Support] ${safeSubject}`,
      text,
      html: renderHtml({
        fullName: safeName,
        email,
        subject: safeSubject,
        description,
        attachmentName: attachment?.filename,
        requestId
      }),
      attachments
    });
    return { messageId: result.messageId || null };
  } catch (error) {
    const deliveryError = new HttpError(502, "Support request could not be delivered. Please try again later.", {
      code: "SUPPORT_DELIVERY_FAILED",
      expose: true
    });
    deliveryError.cause = error;
    throw deliveryError;
  }
}

function getTransporter() {
  if (transporter) return transporter;

  if (config.smtpJsonTransport) {
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });
  return transporter;
}

function renderHtml({ fullName, email, subject, description, attachmentName, requestId }) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f7f7f8;color:#211f22;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:680px;margin:0 auto;padding:28px;border:1px solid #e4e1e5;border-radius:12px;background:#ffffff">
      <p style="margin:0 0 8px;color:#dd2a7b;font-size:12px;font-weight:700;text-transform:uppercase">Editio Support</p>
      <h1 style="margin:0 0 24px;font-size:24px">${escapeHtml(subject)}</h1>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 12px 8px 0;color:#6f6b70">Request ID</td><td style="padding:8px 0">${escapeHtml(requestId)}</td></tr>
        <tr><td style="padding:8px 12px 8px 0;color:#6f6b70">Name</td><td style="padding:8px 0">${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding:8px 12px 8px 0;color:#6f6b70">Email</td><td style="padding:8px 0">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:8px 12px 8px 0;color:#6f6b70">Attachment</td><td style="padding:8px 0">${escapeHtml(attachmentName || "None")}</td></tr>
      </table>
      <div style="margin-top:22px;padding:18px;border-radius:10px;background:#f7f7f8;line-height:1.6;white-space:pre-wrap">${escapeHtml(description)}</div>
    </div>
  </body>
</html>`;
}

function singleLine(value) {
  return String(value).replace(/[\r\n\u2028\u2029]+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
