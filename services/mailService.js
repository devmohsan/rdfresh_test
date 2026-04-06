const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});

const sendCredentials = async (email, name, password) => {
    const mailOptions = {
        from: `"RD Fresh Partnership" <${process.env.MAIL_USER}>`,
        to: email,
        subject: 'Partnership Approved - Your RD Fresh Credentials',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 20px;">
                <h2 style="color: #25d86dff; text-align: center;">Welcome to RD Fresh Partnership!</h2>
                <p>Hello <strong>${name}</strong>,</p>
                <p>We are pleased to inform you that your distributor inquiry has been <strong>approved</strong>. You now have access to our partner portal.</p>
                
                <div style="background-color: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0;">
                    <p style="margin: 0; font-size: 14px; color: #64748b;">Your Login Credentials:</p>
                    <p style="margin: 10px 0 5px 0;"><strong>Email:</strong> ${email}</p>
                    <p style="margin: 0;"><strong>Temporary Password:</strong> <span style="color: #25d86dff; font-family: monospace; font-size: 18px;">${password}</span></p>
                </div>

                <p style="font-size: 14px; color: #64748b;">Please login to your dashboard and change your password upon first entry. You will also be required to acknowledge the NDA protocol before accessing full distributor resources.</p>
                
                <div style="text-align: center; margin-top: 30px;">
                    <a href="${process.env.BASE_URL || 'http://localhost:3000'}/distributor/login" style="background-color: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px;">Access Partner Portal</a>
                </div>
                
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                <p style="font-size: 12px; color: #94a3b8; text-align: center;">© 2026 RD Fresh Preservation Systems. All rights reserved.</p>
            </div>
        `
    };

    return transporter.sendMail(mailOptions);
};

module.exports = { sendCredentials };
