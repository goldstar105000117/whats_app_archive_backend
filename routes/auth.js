const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const {
    validateRegistration,
    validateLogin,
    handleValidationErrors
} = require('../middleware/validation');

// Fixed registration route
router.post('/register',
    validateRegistration,
    handleValidationErrors,
    authController.register
);

// Fixed login route  
router.post('/login',
    validateLogin,
    handleValidationErrors,
    authController.login
);

// Fixed protected routes - make sure auth is a function
router.get('/profile', auth, authController.getProfile);
router.get('/verify', auth, authController.verifyToken);

module.exports = router;