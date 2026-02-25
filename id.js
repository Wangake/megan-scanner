const fs = require('fs-extra');
const path = require('path');

// Generate random ID
function makeid(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Format phone number
function formatPhone(number) {
    let cleaned = number.replace(/[^0-9]/g, '');
    if (cleaned.length === 9) cleaned = '254' + cleaned;
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    }
    return cleaned;
}

// Format code with dashes
function formatCode(code) {
    if (!code) return code;
    return code.match(/.{1,4}/g)?.join('-') || code;
}

// Validate phone number
function validatePhone(number) {
    const cleaned = number.replace(/[^0-9]/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
}

// Get country from number
function getCountry(number) {
    const cleaned = number.replace(/[^0-9]/g, '');
    const prefix = cleaned.substring(0, 3);
    const countries = {
        '254': 'Kenya',
        '255': 'Tanzania',
        '256': 'Uganda',
        '250': 'Rwanda',
        '257': 'Burundi',
        '92': 'Pakistan',
        '91': 'India',
        '1': 'USA/Canada',
        '44': 'UK'
    };
    return countries[prefix] || 'Unknown';
}

module.exports = {
    makeid,
    formatPhone,
    formatCode,
    validatePhone,
    getCountry
};