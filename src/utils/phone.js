/**
 * Normalizes Indian phone numbers for WhatsApp links (wa.me) and database storage.
 * Handles:
 *  - '9820012345'       -> { clean: '9820012345', waPhone: '919820012345', display: '+91 98200 12345' }
 *  - '09820012345'      -> { clean: '9820012345', waPhone: '919820012345', display: '+91 98200 12345' }
 *  - '+91 98200 12345'  -> { clean: '9820012345', waPhone: '919820012345', display: '+91 98200 12345' }
 *  - '+9109820012345'   -> { clean: '9820012345', waPhone: '919820012345', display: '+91 98200 12345' }
 *  - '919820012345'     -> { clean: '9820012345', waPhone: '919820012345', display: '+91 98200 12345' }
 *  - '00919820012345'   -> { clean: '9820012345', waPhone: '919820012345', display: '+91 98200 12345' }
 */

function normalizePhone(rawPhone) {
  if (!rawPhone) {
    return {
      raw: '',
      clean: '',
      waPhone: '',
      display: '',
      isValid: false,
    };
  }

  const raw = String(rawPhone).trim();
  // Strip all non-digits
  let digits = raw.replace(/\D/g, '');

  // Strip international dialing prefixes: '0091' -> '91...'
  if (digits.startsWith('0091')) {
    digits = digits.slice(2);
  }

  // If starts with '91' and has more than 10 digits (e.g. 12 or 13 digits)
  if (digits.startsWith('91') && digits.length >= 12) {
    digits = digits.slice(2);
  }

  // Strip any leading zeros (e.g. '09820012345' -> '9820012345', '00...' -> '...')
  digits = digits.replace(/^0+/, '');

  let clean = digits;
  let waPhone = '';
  let display = '';
  let isValid = false;

  // Standard Indian 10-digit mobile check (starts with 6, 7, 8, or 9)
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    clean = digits;
    waPhone = `91${digits}`;
    display = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    isValid = true;
  } else if (digits.length > 10) {
    // If extra digits exist (like someone passed 91 + 0 + 10 digits), check the trailing 10 digits
    const last10 = digits.slice(-10);
    if (/^[6-9]\d{9}$/.test(last10)) {
      clean = last10;
      waPhone = `91${last10}`;
      display = `+91 ${last10.slice(0, 5)} ${last10.slice(5)}`;
      isValid = true;
    } else {
      // Non-standard international or landline
      waPhone = digits;
      display = `+${digits}`;
      isValid = digits.length >= 7;
    }
  } else if (digits.length === 10) {
    // 10 digits but starts with other digit (e.g. landline)
    clean = digits;
    waPhone = `91${digits}`;
    display = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    isValid = true;
  } else {
    // Shorter than 10 digits
    clean = digits;
    waPhone = digits ? `91${digits}` : '';
    display = digits;
    isValid = false;
  }

  return {
    raw,
    clean,       // 10-digit clean string: '9820012345'
    waPhone,     // International format without + for WhatsApp: '919820012345'
    display,     // Formatted display string: '+91 98200 12345'
    isValid,
  };
}

module.exports = {
  normalizePhone,
};
