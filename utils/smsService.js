const axios = require('axios');

/**
 * Format phone number for Fast2SMS
 * @param {string} phone - Phone number
 * @param {string} countryCode - Country code prefix (default: 91 for India)
 * @returns {string} - Formatted phone number
 */
const formatPhoneNumber = (phone, countryCode = '91') => {
  const cleanPhone = phone.replace(/\D/g, '');

  if (cleanPhone.length === 10) {
    return cleanPhone;
  }

  if (cleanPhone.startsWith(countryCode) && cleanPhone.length === countryCode.length + 10) {
    return cleanPhone.slice(-10);
  }

  if (cleanPhone.length > 10) {
    return cleanPhone.slice(-10);
  }

  return cleanPhone;
};


const sendOTPSMS = async (phone, otp, type = 'verification') => {
  try {
    const apiKey = process.env.FAST2SMS_API_KEY || process.env.OTP_SMS_API_KEY;
    const messageId = process.env.FAST2SMS_MESSAGE_ID || process.env.MASSAGE_ID || '2898';

    if (!apiKey) {
      throw new Error('FAST2SMS API key is not configured');
    }

    const formattedPhone = formatPhoneNumber(phone);
    const apiUrl = `https://www.fast2sms.com/dev/whatsapp?authorization=${apiKey}&message_id=${messageId}&numbers=${formattedPhone}&variables_values=${otp}`;
    const response = await axios.get(apiUrl);

    console.log(`SMS sent successfully to ${formattedPhone} for ${type}`, response.data);
    return true;
  } catch (error) {
    console.error('Error sending SMS:', error);

    if (error.response) {
      console.error('Fast2SMS Error Response:', error.response.data);
    }

    if (error.code) {
      console.error(`Fast2SMS Error Code: ${error.code} - ${error.message}`);
    }

    return false;
  }
};


const validatePhoneNumber = (phone) => {
  // Basic phone number validation
  const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Check if phone has at least 10 digits
  return cleanPhone.length >= 10 && phoneRegex.test(phone.replace(/\s/g, ''));
};

/**
 * Get SMS delivery status
 * @param {string} messageSid - Twilio message SID
 * @returns {Promise<Object>} - Message status object
 */


module.exports = {
  sendOTPSMS,
  validatePhoneNumber,
  formatPhoneNumber,
};
