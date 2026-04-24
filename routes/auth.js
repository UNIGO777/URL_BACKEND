/**
 * Authentication Routes
 * Handles all authentication-related API endpoints
 */

const express = require('express');
const router = express.Router();

// Import controllers
const authController = require('../controllers/authController');
const googleController = require('../controllers/googleController');
const reactNativeGoogleController = require('../controllers/reactNativeGoogleController');

// Import middleware
const { authenticate, authRateLimit } = require('../middleware/auth');

// ============================================================================
// REGISTRATION ROUTES
// ============================================================================

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user
 *     description: Register a new user with email or phone verification via OTP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - identifierType
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email address or phone number
 *                 example: "user@example.com"
 *               identifierType:
 *                 type: string
 *                 enum: [email, phone]
 *                 description: Type of identifier (email or phone)
 *                 example: "email"
 *               fullName:
 *                 type: string
 *                 description: User's full name
 *                 example: "John Doe"
 *               ageGroup:
 *                 type: string
 *                 description: User's age group
 *                 example: "25-34"
 *     responses:
 *       201:
 *         description: User registered successfully, OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "Registration successful. Please verify your email/phone with the OTP sent."
 *               data:
 *                 userId: "60f7b3b3b3b3b3b3b3b3b3b3"
 *                 identifier: "user@example.com"
 *                 isVerified: false
 *       400:
 *         description: Bad request - validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: User already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

router.use((req, res, next) => {
    console.log('Request received:', req.method, req.path);
    next();
});

router.post('/register', authRateLimit, authController.register);

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify OTP for registration
 *     description: Verify the OTP sent during registration to complete account verification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - otp
 *               - type
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email address or phone number
 *                 example: "user@example.com"
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP code
 *                 example: "123456"
 *               type:
 *                 type: string
 *                 enum: [email, phone]
 *                 description: Type of verification
 *                 example: "email"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/verify-otp', authRateLimit, authController.verifyOTP);

/**
 * @swagger
 * /api/auth/resend-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Resend OTP
 *     description: Resend an OTP for registration, login, password reset, email verification, or identifier change
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email address or phone number
 *                 example: "user@example.com"
 *               type:
 *                 type: string
 *                 enum: [registration, login, password_reset, email_verification, identifier_change]
 *                 description: Purpose of the OTP
 *                 example: "registration"
 *     responses:
 *       200:
 *         description: OTP resent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "OTP sent successfully to your email"
 *               data:
 *                 identifier: "user@example.com"
 *                 identifierType: "email"
 *                 otpType: "registration"
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to send OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/resend-otp', authRateLimit, authController.resendOTP);

// ============================================================================
// LOGIN ROUTES
// ============================================================================

/**
 * @swagger
 * /api/auth/login/request-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Request OTP for login
 *     description: Request OTP code for passwordless login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - type
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email address or phone number
 *                 example: "user@example.com"
 *               type:
 *                 type: string
 *                 enum: [email, phone]
 *                 description: Type of login method
 *                 example: "email"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login/request-otp', authRateLimit, authController.requestLoginOTP);

/**
 * @swagger
 * /api/auth/login/verify-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify OTP and login user
 *     description: Verify OTP code and authenticate user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - otp
 *               - type
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email address or phone number
 *                 example: "user@example.com"
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP code
 *                 example: "123456"
 *               type:
 *                 type: string
 *                 enum: [email, phone]
 *                 description: Type of login method
 *                 example: "email"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       description: JWT authentication token
 *       400:
 *         description: Invalid OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login/verify-otp', authRateLimit, authController.verifyLoginOTP);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Logout user
 *     description: Logout the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/logout', authenticate, authController.logout);

// ============================================================================
// PASSWORD RESET ROUTES
// ============================================================================

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Request password reset
 *     description: Request a password reset token via email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email address
 *                 example: "user@example.com"
 *     responses:
 *       200:
 *         description: Password reset email sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/forgot-password', authRateLimit, authController.forgotPassword);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Reset password with token
 *     description: Reset user password using the reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 description: Password reset token
 *                 example: "abc123def456"
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 description: New password (minimum 6 characters)
 *                 example: "newpassword123"
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid or expired token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/reset-password', authRateLimit, authController.resetPassword);

// ============================================================================
// EMAIL VERIFICATION ROUTES
// ============================================================================

/**
 * @route   GET /auth/verify-email
 * @desc    Verify email address
 * @access  Public
 */
router.get('/verify-email', authController.verifyEmail);

/**
 * @route   POST /auth/resend-verification
 * @desc    Resend email verification
 * @access  Private
 */
router.post('/resend-verification', authenticate, authController.verifyEmail);

// ============================================================================
// GOOGLE OAUTH ROUTES
// ============================================================================

/**
 * @swagger
 * /api/auth/google/login:
 *   post:
 *     tags: [Google OAuth]
 *     summary: Google ID token login
 *     description: Authenticate user using Google ID token (Gmail accounts only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Google ID token from client-side authentication
 *                 example: "eyJhbGciOiJSUzI1NiIsImtpZCI6..."
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Google login successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       description: JWT authentication token
 *                     isGoogleLinked:
 *                       type: boolean
 *                       example: true
 *       400:
 *         description: Invalid token or non-Gmail account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/google/login', authRateLimit, googleController.googleLogin);

/**
 * @swagger
 * /api/auth/google/auth-url:
 *   get:
 *     tags: [Google OAuth]
 *     summary: Get Google OAuth authorization URL
 *     description: Generate Google OAuth authorization URL for client-side authentication
 *     responses:
 *       200:
 *         description: Authorization URL generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     authUrl:
 *                       type: string
 *                       format: uri
 *                       description: Google OAuth authorization URL
 *                       example: "https://accounts.google.com/o/oauth2/v2/auth?client_id=..."
 *                     clientId:
 *                       type: string
 *                       description: Google OAuth client ID
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/google/auth-url', googleController.getGoogleAuthURL);

/**
 * @swagger
 * /api/auth/google:
 *   get:
 *     tags: [Google OAuth]
 *     summary: Initiate Google OAuth flow
 *     description: Redirect to Google OAuth authorization page
 *     responses:
 *       302:
 *         description: Redirect to Google OAuth
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               format: uri
 *               description: Google OAuth authorization URL
 */
router.get('/google', googleController.googleAuth);

/**
 * @swagger
 * /api/auth/google/callback:
 *   get:
 *     tags: [Google OAuth]
 *     summary: Google OAuth callback
 *     description: Handle Google OAuth callback after user authorization
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Authorization code from Google
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: State parameter for CSRF protection
 *     responses:
 *       302:
 *         description: Redirect to success or failure page
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               format: uri
 *               description: Redirect URL
 */
router.get('/google/callback', googleController.googleCallback);

/**
 * @swagger
 * /api/auth/google/success:
 *   get:
 *     tags: [Google OAuth]
 *     summary: Google OAuth success handler
 *     description: Handle successful Google OAuth authentication
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Google authentication successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       description: JWT authentication token
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/google/success', googleController.googleSuccess);

/**
 * @swagger
 * /api/auth/google/failure:
 *   get:
 *     tags: [Google OAuth]
 *     summary: Google OAuth failure handler
 *     description: Handle failed Google OAuth authentication
 *     responses:
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: "Google authentication failed"
 *               error: "Authentication was cancelled or failed"
 */
router.get('/google/failure', googleController.googleFailure);

/**
 * @swagger
 * /api/auth/google/link:
 *   post:
 *     tags: [Google OAuth]
 *     summary: Link Google account to existing user
 *     description: Link a Google account to the currently authenticated user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Google ID token from client-side authentication
 *                 example: "eyJhbGciOiJSUzI1NiIsImtpZCI6..."
 *     responses:
 *       200:
 *         description: Google account linked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Google account linked successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     isGoogleLinked:
 *                       type: boolean
 *                       example: true
 *       400:
 *         description: Invalid token or account already linked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/google/link', authenticate, googleController.linkGoogleAccount);

/**
 * @swagger
 * /api/auth/google/unlink:
 *   delete:
 *     tags: [Google OAuth]
 *     summary: Unlink Google account from user
 *     description: Remove Google account link from the currently authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Google account unlinked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Google account unlinked successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     isGoogleLinked:
 *                       type: boolean
 *                       example: false
 *       400:
 *         description: No Google account linked or cannot unlink
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/google/unlink', authenticate, googleController.unlinkGoogleAccount);

/**
 * @swagger
 * /api/auth/google/complete:
 *   post:
 *     tags: [Google OAuth]
 *     summary: Complete Google OAuth registration with additional info
 *     description: Complete Google OAuth registration by providing additional required information
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tempId
 *               - phone
 *               - ageGroup
 *             properties:
 *               tempId:
 *                 type: string
 *                 description: Temporary ID from OAuth callback
 *                 example: "abc123def456"
 *               phone:
 *                 type: string
 *                 description: User's phone number
 *                 example: "+1234567890"
 *               ageGroup:
 *                 type: string
 *                 description: User's age group
 *                 example: "25-34"
 *     responses:
 *       201:
 *         description: Google OAuth registration completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Google OAuth registration completed successfully"
 *                 token:
 *                   type: string
 *                   description: JWT authentication token
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid or missing data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/google/complete', authRateLimit, googleController.completeGoogleAuth);

// ============================================================================
// REACT NATIVE GOOGLE AUTHENTICATION ROUTES
// ============================================================================

/**
 * @swagger
 * /api/auth/react-native/google/login:
 *   post:
 *     tags: [React Native Authentication]
 *     summary: React Native Google OAuth login
 *     description: Authenticate user with Google ID token or access token for React Native apps
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Google ID token from React Native OAuth
 *               accessToken:
 *                 type: string
 *                 description: Google access token from React Native OAuth
 *             oneOf:
 *               - required: [idToken]
 *               - required: [accessToken]
 *     responses:
 *       200:
 *         description: Login successful or requires age group for new user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 requiresAgeGroup:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid token or unverified email
 *       401:
 *         description: Invalid Google token
 *       500:
 *         description: Internal server error
 */
router.post('/react-native/google/login', authRateLimit, reactNativeGoogleController.reactNativeGoogleLogin);

/**
 * @swagger
 * /api/auth/react-native/google/complete:
 *   post:
 *     tags: [React Native Authentication]
 *     summary: Complete React Native Google registration
 *     description: Complete Google registration for new users by providing age group
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tempUserData
 *               - ageGroup
 *             properties:
 *               tempUserData:
 *                 type: object
 *                 description: Temporary user data from initial Google login
 *               ageGroup:
 *                 type: string
 *                 description: User's age group
 *                 enum: ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
 *     responses:
 *       201:
 *         description: Registration completed successfully
 *       400:
 *         description: Missing data or user already exists
 *       500:
 *         description: Internal server error
 */
router.post('/react-native/google/complete', authRateLimit, reactNativeGoogleController.completeReactNativeGoogleRegistration);

/**
 * @swagger
 * /api/auth/react-native/google/config:
 *   get:
 *     tags: [React Native Authentication]
 *     summary: Get Google OAuth configuration for React Native
 *     description: Get Google OAuth client configuration for React Native apps
 *     responses:
 *       200:
 *         description: Configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     clientId:
 *                       type: string
 *                     scopes:
 *                       type: array
 *                       items:
 *                         type: string
 *                     responseType:
 *                       type: string
 *                     redirectUri:
 *                       type: string
 *       500:
 *         description: Internal server error
 */
router.get('/react-native/google/config', reactNativeGoogleController.getReactNativeGoogleConfig);

module.exports = router;
