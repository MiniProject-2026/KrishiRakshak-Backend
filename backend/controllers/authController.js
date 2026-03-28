const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
};

const createTransporter = () => nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,       // false for port 587 (STARTTLS)
  requireTLS: true,    // force STARTTLS upgrade
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// @desc  Register user — sends email OTP, does NOT log in yet
// @route POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser && existingUser.isVerified) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpire = Date.now() + 10 * 60 * 1000; // 10 mins

    if (existingUser && !existingUser.isVerified) {
      // Resend OTP for unverified account
      existingUser.name = name;
      existingUser.password = password;
      existingUser.emailOTP = otp;
      existingUser.emailOTPExpire = otpExpire;
      await existingUser.save();
    } else {
      await User.create({ name, email, password, emailOTP: otp, emailOTPExpire: otpExpire });
    }

    const transporter = createTransporter();

    await transporter.sendMail({
      from: `"KrishiRakshak" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Verify Your Email — KrishiRakshak',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
          <h2 style="color: #2d6a4f;">🌿 KrishiRakshak</h2>
          <p>Hi ${name},</p>
          <p>Your email verification OTP is:</p>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2d6a4f; text-align: center; padding: 20px; background: #d8f3dc; border-radius: 8px; margin: 16px 0;">
            ${otp}
          </div>
          <p>This OTP expires in <strong>10 minutes</strong>.</p>
          <p>If you did not create an account, please ignore this email.</p>
        </div>
      `,
    });

    res.status(200).json({ message: 'OTP sent to your email. Please verify to complete signup.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Verify email OTP and complete registration
// @route POST /api/auth/verify-email
const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({
      email,
      emailOTP: otp,
      emailOTPExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.emailOTP = undefined;
    user.emailOTPExpire = undefined;
    await user.save();

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Login user
// @route POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email before logging in' });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Google OAuth login
// @route POST /api/auth/google
const googleLogin = async (req, res) => {
  try {
    const { token, userInfo } = req.body;

    let googleId, email, name, picture;

    if (userInfo && userInfo.sub) {
      // Access token flow — frontend sends userInfo directly
      googleId = userInfo.sub;
      email = userInfo.email;
      name = userInfo.name;
      picture = userInfo.picture;
    } else {
      // ID token flow fallback
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      googleId = payload.sub;
      email = payload.email;
      name = payload.name;
      picture = payload.picture;
    }

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name,
        email,
        googleId,
        avatar: picture,
        authProvider: 'google',
        isVerified: true, // Google already verified the email
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      user.avatar = user.avatar || picture;
      user.authProvider = 'google';
      user.isVerified = true;
      await user.save();
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(401).json({ message: 'Google authentication failed' });
  }
};

// @desc  Forgot password - send OTP
// @route POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'No user found with this email' });
    }

    if (user.authProvider === 'google') {
      return res.status(400).json({ message: 'Please sign in with Google for this account' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordToken = otp;
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 mins
    await user.save({ validateBeforeSave: false });

    const transporter = createTransporter();

    await transporter.sendMail({
      from: `"KrishiRakshak" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Your Password Reset OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
          <h2 style="color: #2d6a4f;">🌿 KrishiRakshak</h2>
          <p>Hi ${user.name},</p>
          <p>Your OTP for password reset is:</p>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2d6a4f; text-align: center; padding: 20px; background: #d8f3dc; border-radius: 8px; margin: 16px 0;">
            ${otp}
          </div>
          <p>This OTP expires in <strong>10 minutes</strong>.</p>
          <p>If you did not request this, please ignore this email.</p>
        </div>
      `,
    });

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Verify OTP and reset password
// @route POST /api/auth/verify-otp
const verifyOTP = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({
      email,
      resetPasswordToken: otp,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Reset password
// @route PUT /api/auth/reset-password/:token
const resetPassword = async (req, res) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Get current user
// @route GET /api/auth/me
const getMe = async (req, res) => {
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    avatar: req.user.avatar,
    authProvider: req.user.authProvider,
    createdAt: req.user.createdAt,
  });
};

module.exports = { register, login, googleLogin, forgotPassword, resetPassword, getMe, verifyOTP, verifyEmail };
