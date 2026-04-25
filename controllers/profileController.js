const User = require("../models/user");
const bcrypt = require("bcryptjs");
const { getAppSettings, updateAppSettings } = require("../config/appSettings");

// Get current user profile
async function getProfile(req, res) {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Update current user profile
async function updateProfile(req, res) {
  try {
    const { fullName, rollNumber, className } = req.body;
    const updateFields = {};

    if (fullName !== undefined) updateFields.fullName = fullName;
    if (rollNumber !== undefined) updateFields.rollNumber = rollNumber;
    if (className !== undefined) updateFields.className = className;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateFields },
      { new: true }
    ).select("-password");

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Change password
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ ok: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Get app settings (public endpoint)
async function getSettings(req, res) {
  try {
    const appSettings = getAppSettings();
    // Return settings without sensitive data
    const publicSettings = {
      appName: appSettings.appName,
      instituteName: appSettings.instituteName,
      logoUrl: appSettings.logoUrl,
      contactEmail: appSettings.contactEmail,
      contactPhone: appSettings.contactPhone,
      address: appSettings.address,
      termsAndConditions: appSettings.termsAndConditions,
      allowStudentLogin: appSettings.allowStudentLogin,
      allowTeacherLogin: appSettings.allowTeacherLogin,
      examDurationBuffer: appSettings.examDurationBuffer,
      defaultPassword: appSettings.defaultPassword,
      seatingStrategy: appSettings.seatingStrategy
    };
    res.json(publicSettings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Update app settings (admin only)
async function updateSettings(req, res) {
  try {
    const {
      appName,
      instituteName,
      logoUrl,
      contactEmail,
      contactPhone,
      address,
      termsAndConditions,
      allowStudentLogin,
      allowTeacherLogin,
      examDurationBuffer,
      defaultPassword,
      seatingStrategy
    } = req.body;

    const nextSettings = updateAppSettings({
      appName,
      instituteName,
      logoUrl,
      contactEmail,
      contactPhone,
      address,
      termsAndConditions,
      allowStudentLogin,
      allowTeacherLogin,
      examDurationBuffer,
      defaultPassword,
      seatingStrategy
    });

    res.json({ ok: true, settings: nextSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Get terms and conditions (public endpoint)
async function getTerms(req, res) {
  try {
    const appSettings = getAppSettings();
    res.json({ terms: appSettings.termsAndConditions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getSettings,
  updateSettings,
  getTerms
};
