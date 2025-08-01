    const functions = require('firebase-functions');
    const admin = require('firebase-admin');
    const express = require('express');
    const cors = require('cors');

    // Initialize Firebase Admin SDK (it picks up credentials automatically in Cloud Functions environment)
    admin.initializeApp();
    const db = admin.firestore();

    const app = express();

    // Configure CORS for your Cloud Function (allow requests from your deployed frontend)
    // IMPORTANT: In production, replace '*' with your actual frontend domain(s)
    app.use(cors({ origin: true }));
    app.use(express.json()); // Middleware to parse JSON request bodies

    // --- Utility Middleware for Admin Authorization ---
    // This middleware will verify Firebase ID tokens and check user roles from Firestore
    const authorizeAdmin = (allowedRoles) => async (req, res, next) => {
        if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
            console.warn('Backend: Unauthorized access attempt: No Authorization header or malformed.');
            return res.status(403).json({ error: 'Unauthorized: No token provided.' });
        }

        const idToken = req.headers.authorization.split('Bearer ')[1];

        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            req.user = decodedToken; // Attach decoded token to request for downstream use

            // Fetch user's role from Firestore
            const userDocRef = db.collection('users').doc(req.user.uid);
            const userDocSnap = await userDocRef.get();

            if (!userDocSnap.exists) {
                console.warn(`Backend: Unauthorized access attempt: User profile not found for UID: ${req.user.uid}`);
                return res.status(403).json({ error: 'Unauthorized: User profile not found.' });
            }

            const userData = userDocSnap.data();
            const userRole = userData.role || (userData.is_admin ? 'admin' : null); // Get current user's role

            if (!allowedRoles.includes(userRole)) {
                console.warn(`Backend: Unauthorized access attempt: User ${req.user.uid} with role ${userRole} is not in allowed roles: ${allowedRoles.join(', ')}`);
                return res.status(403).json({ error: 'Unauthorized: Insufficient permissions.' });
            }

            console.log(`Backend: User ${req.user.uid} with role ${userRole} authorized for route.`);
            next(); // User is authorized, proceed to the next middleware/route handler

        } catch (error) {
            console.error('Backend: Error verifying ID token or fetching role:', error);
            return res.status(403).json({ error: 'Unauthorized: Invalid token or forbidden.' });
        }
    };


    // --- Global Constants (should be kept in sync with frontend mockData.js) ---
    // Ideally, these would be fetched from a central config in production
    const TIER_LIMITS = {
        tier1: 8,
        tier2: 20,
        tier3: 50
    };
    const AVAILABLE_COUNTRIES = ['Canada', 'USA', 'Spain'];
    const DEFAULT_USER_DATA = { // Minimal default data for new users created by backend fallback
        userId: null,
        email: null,
        tier: 'tier1',
        selected_country: null,
        daily_numbers_shown: 0,
        last_activity_date: null,
        country_lock_date: null,
        saved_numbers: [],
        shown_numbers: [],
        role: null, // Default role is null
        hasSeenGuide: false // New field to track if user has seen the guide
    };

    // --- Utility for consistent date conversion from frontend ISO string to Firestore Timestamp
    const convertToDateOrNull = (value) => {
        if (value instanceof Date) {
            return value;
        }
        if (typeof value === 'string' && !isNaN(new Date(value).getTime())) {
            return new Date(value);
        }
        return null;
    };


    // --- API Endpoints ---

    // Basic Test Route (for checking function deployment)
    app.get('/', (req, res) => {
        res.status(200).send('WhatsApp Backend Function is running!');
    });


    // GET /api/get-number: Get a unique WhatsApp number for the user
   app.get('/get-number', async (req, res) => {
  try {
    const { tier, country, userId } = req.query;

    if (!userId || !tier || !country) {
      return res.status(400).json({ error: 'User ID, tier, and country are required.' });
    }

    const collectionName = `whatsapp_numbers_${country.toLowerCase()}`;
    const userDocRef = db.collection('users').doc(userId);

    const result = await db.runTransaction(async (transaction) => {
      // --- READS FIRST ---
      const userDocSnap = await transaction.get(userDocRef);
      let userData = {};

      const numbersQuery = db.collection(collectionName)
        .where('tier', '==', tier)
        .where('is_available', '==', true)
        .where('distributed_to_userId', '==', null)
        .limit(100);

      const numbersSnapshot = await transaction.get(numbersQuery);

      if (!userDocSnap.exists) {
        // Set default data, but defer write until after all reads
        userData = {
          userId,
          email: null,
          tier: 'tier1',
          selected_country: null,
          daily_numbers_shown: 0,
          last_activity_date: admin.firestore.FieldValue.serverTimestamp(),
          country_lock_date: null,
          saved_numbers: [],
          shown_numbers: [],
          role: null,
          hasSeenGuide: false,
        };
        transaction.set(userDocRef, userData);
      } else {
        userData = { ...userDocSnap.data() };
        userData.last_activity_date = userData.last_activity_date?.toDate?.() || null;
        userData.country_lock_date = userData.country_lock_date?.toDate?.() || null;
      }

      const currentTierLimit = TIER_LIMITS[userData.tier] || 0;
      const today = new Date();

      const lastActivity = userData.last_activity_date ? new Date(userData.last_activity_date) : null;
      const isNewDay =
        !lastActivity ||
        lastActivity.getDate() !== today.getDate() ||
        lastActivity.getMonth() !== today.getMonth() ||
        lastActivity.getFullYear() !== today.getFullYear();

      if (isNewDay) {
        userData.daily_numbers_shown = 0;
        userData.shown_numbers = [];
      }

      if (userData.daily_numbers_shown >= currentTierLimit) {
        throw new Error(`You have reached your daily limit of ${currentTierLimit} numbers.`);
      }

      const availableNumbers = [];
      numbersSnapshot.forEach(doc => {
        const numberData = doc.data();
        if (
          !userData.shown_numbers.includes(numberData.number) &&
          !userData.saved_numbers?.includes(numberData.number)
        ) {
          availableNumbers.push({ id: doc.id, ...numberData });
        }
      });

      if (availableNumbers.length === 0) {
        throw new Error('No more unique numbers available for your tier/country today.');
      }

      // --- WRITES START HERE ---
      const selected = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
      const selectedRef = db.collection(collectionName).doc(selected.id);
      const latestSelectedDoc = await transaction.get(selectedRef);

      if (latestSelectedDoc.exists && latestSelectedDoc.data().distributed_to_userId !== null) {
        throw new Error('Number was concurrently distributed to another user. Try again.');
      }

      const updatedShownNumbers = [...userData.shown_numbers, selected.number];

      transaction.update(userDocRef, {
        daily_numbers_shown: userData.daily_numbers_shown + 1,
        shown_numbers: updatedShownNumbers,
        last_activity_date: admin.firestore.FieldValue.serverTimestamp(),
        country_lock_date: userData.country_lock_date || null,
      });

      transaction.update(selectedRef, {
        distributed_to_userId: userId,
        last_distributed_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { number: selected.number };
    });

    res.status(200).json(result);

  } catch (error) {
    console.error('Backend: Error in get-number:', error.message);
    if (error.message.includes('limit') || error.message.includes('unique')) {
      res.status(403).json({ message: error.message });
    } else if (error.message.includes('concurrently')) {
      res.status(409).json({ message: error.message });
    } else {
      res.status(500).json({ error: error.message || 'Failed to retrieve number.' });
    }
  }
});

//upgrade to use the new get-number endpoint

    // POST /upgrade-tier: Super admin upgrades a user's tier
app.post('/upgrade-tier', authorizeAdmin(['super_admin']), async (req, res) => {
  const { userId, newTier } = req.body;
  const adminUser = req.user; // Authenticated super_admin

  const allowedTiers = ['tier1', 'tier2', 'tier3'];

  // --- Input validation ---
  if (!userId || !newTier) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Both userId and newTier are required.',
    });
  }

  if (!allowedTiers.includes(newTier)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `Invalid tier "${newTier}". Allowed values are: ${allowedTiers.join(', ')}.`,
    });
  }

  const userDocRef = db.collection('users').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDocSnap = await transaction.get(userDocRef);

      if (!userDocSnap.exists) {
        throw new Error('User profile not found.');
      }

      const userData = userDocSnap.data();

      if (userData.tier === newTier) {
        throw new Error(`User is already on "${newTier}".`);
      }

      const updatedData = {
        tier: newTier,
        daily_numbers_shown: 0,
        shown_numbers: [],
        last_activity_date: admin.firestore.FieldValue.serverTimestamp(),
        country_lock_date: null,
        selected_country: null,
      };

      transaction.update(userDocRef, updatedData);
    });

    console.log(
      `Backend: Super Admin (${adminUser.uid}) upgraded user ${userId} to ${newTier}.`
    );
    return res.status(200).json({
      message: `User ${userId} successfully upgraded to "${newTier}".`,
    });

  } catch (error) {
    console.error('Backend: Error upgrading user tier:', error.message);

    if (error.message.includes('already on')) {
      return res.status(409).json({
        error: 'Conflict',
        message: error.message,
      });
    } else if (error.message.includes('User profile not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to upgrade user tier.',
    });
  }
});

    // POST /api/save-number: Save a number to user's saved_numbers
    app.post('/save-number', async (req, res) => {
        try {
            const { number, userId } = req.body;

            if (!number || !userId) {
                return res.status(400).json({ error: 'Number and user ID are required.' });
            }

            const userDocRef = db.collection('users').doc(userId);

            await db.runTransaction(async (transaction) => {
                const userDocSnap = await transaction.get(userDocRef);
                if (!userDocSnap.exists) {
                    console.warn(`Backend: User profile not found for saving number for UID: ${userId}`);
                    return res.status(404).json({ error: 'User profile not found for saving number.' });
                }

                const userData = userDocSnap.data();
                const savedNumbers = userData.saved_numbers || [];

                if (savedNumbers.includes(number)) {
                    return res.status(409).json({ message: 'Number is already saved.' });
                }

                const updatedSavedNumbers = [...savedNumbers, number];
                transaction.update(userDocRef, { saved_numbers: updatedSavedNumbers });

                console.log(`Backend: Number ${number} saved by user ${userId}.`);
                res.status(200).json({ message: 'Number saved successfully.' });
            });

        } catch (error) {
            console.error('Backend: Error in save-number:', error);
            res.status(500).json({ error: error.message || 'Failed to save number.' });
        }
    });

    // POST /api/upload-batch: Upload multiple numbers (admin/super_admin only)
    app.post('/upload-batch', authorizeAdmin(['super_admin', 'admin']), async (req, res) => {
        try {
            const { country, tier, numbers, source_batch_id } = req.body;

            if (!country || !tier || !Array.isArray(numbers) || numbers.length === 0) {
                return res.status(400).json({ error: 'Country, tier, and an array of numbers are required.' });
            }

            if (!AVAILABLE_COUNTRIES.includes(country) || !TIER_LIMITS[tier]) {
                return res.status(400).json({ error: 'Invalid tier or country provided.' });
            }

            const collectionName = `whatsapp_numbers_${country.toLowerCase()}`;
            const batch = db.batch();
            let uploadedCount = 0;
            const skippedCount = 0;
            const existingNumbersInBatch = new Set(); // To prevent duplicates within the same batch upload request

            for (const num of numbers) {
                const cleanedNum = num.trim();
                if (cleanedNum && !existingNumbersInBatch.has(cleanedNum)) {
                    existingNumbersInBatch.add(cleanedNum);
                    const newNumberDocRef = db.collection(collectionName).doc(); // Auto-generated ID

                    batch.set(newNumberDocRef, {
                        number: cleanedNum,
                        tier: tier,
                        country: country,
                        is_available: true,
                        last_distributed_at: null, // Initially null
                        distributed_to_userId: null, // Initially null
                        source_batch_id: source_batch_id || null,
                        uploaded_at: admin.firestore.FieldValue.serverTimestamp()
                    });
                    uploadedCount++;
                }
            }

            if (uploadedCount === 0) {
                return res.status(400).json({ message: 'No valid unique numbers provided in the batch.' });
            }

            await batch.commit();
            console.log(`Backend: Uploaded ${uploadedCount} numbers to ${collectionName} for tier ${tier}.`);
            res.status(200).json({ message: `Successfully uploaded ${uploadedCount} numbers. ${skippedCount} duplicates skipped.` });

        } catch (error) {
            console.error('Backend: Error in upload-batch:', error);
            res.status(500).json({ error: error.message || 'Failed to upload batch.' });
        }
    });

    // PUT /api/users/:userId/manage: Update user profile (super_admin only)
    app.put('/users/:userId/manage', authorizeAdmin(['super_admin']), async (req, res) => {
        try {
            const { userId } = req.params;
            const { tier, role, email } = req.body; // email field for potential future update via Auth Admin SDK

            if (!userId) {
                return res.status(400).json({ error: 'User ID is required.' });
            }
            if (!tier && !role && !email) {
                return res.status(400).json({ error: 'No fields provided for update (tier, role, or email).' });
            }

            const userDocRef = db.collection('users').doc(userId);
            const updateData = {};

            // Validate and prepare update data
            if (tier && TIER_LIMITS[tier]) {
                updateData.tier = tier;
                // Reset daily stats on tier change (enforced by backend)
                updateData.daily_numbers_shown = 0;
                updateData.shown_numbers = [];
                updateData.last_activity_date = admin.firestore.FieldValue.serverTimestamp();
                updateData.country_lock_date = null;
                updateData.selected_country = null;
            } else if (tier) { // If tier is provided but invalid
                return res.status(400).json({ error: 'Invalid tier value.' });
            }

            if (role !== undefined) { // Allow role to be explicitly set to null (empty string from select)
                if (role === null || ['admin', 'super_admin'].includes(role)) {
                    updateData.role = role;
                } else {
                    return res.status(400).json({ error: 'Invalid role value. Must be "admin", "super_admin", or null.' });
                }
            }
            // TODO: If changing email, this requires Firebase Auth Admin SDK (admin.auth().updateUser(userId, { email: newEmail }))
            // For now, it only updates the Firestore field, not the Auth record.
            if (email) {
                // Basic email format validation (more robust regex might be needed)
                if (typeof email === 'string' && email.includes('@') && email.includes('.')) {
                    updateData.email = email;
                } else {
                    return res.status(400).json({ error: 'Invalid email format.' });
                }
            }


            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update.' });
            }

            await db.runTransaction(async (transaction) => {
                const userDocSnap = await transaction.get(userDocRef);
                if (!userDocSnap.exists) {
                    console.warn(`Backend: User profile not found for management for UID: ${userId}`);
                    return res.status(404).json({ error: 'User profile not found.' });
                }
                transaction.update(userDocRef, updateData);
            });

            console.log(`Backend: User ${userId} updated with:`, updateData);
            res.status(200).json({ message: 'User updated successfully.', updatedFields: updateData });

        } catch (error) {
            console.error('Backend: Error managing user:', error);
            res.status(500).json({ error: error.message || 'Failed to manage user.' });
        }
    });

    // GET /api/users: Get all users (super_admin only)
    app.get('/users', authorizeAdmin(['super_admin']), async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 10;
            const startAfterUserId = req.query.startAfter;

            let query = db.collection('users').orderBy('userId').limit(limit + 1); // Fetch one more for hasMore check

            if (startAfterUserId) {
                const startAfterDoc = await db.collection('users').doc(startAfterUserId).get();
                if (!startAfterDoc.exists) {
                    return res.status(400).json({ error: 'startAfter user not found.' });
                }
                query = query.startAfter(startAfterDoc);
            }

            const snapshot = await query.get();
            const users = [];
            let lastUser = null;
            snapshot.forEach(doc => {
                users.push({ id: doc.id, ...doc.data() });
                lastUser = doc.id;
            });

            const hasMore = users.length > limit;
            if (hasMore) {
                users.pop(); // Remove the extra fetched document
            }

            // Convert Firestore Timestamps to ISO strings for frontend
            const formattedUsers = users.map(user => ({
                ...user,
                last_activity_date: user.last_activity_date ? user.last_activity_date.toDate().toISOString() : null,
                country_lock_date: user.country_lock_date ? user.country_lock_date.toDate().toISOString() : null,
            }));

            res.status(200).json({ users: formattedUsers, lastUser: lastUser, hasMore: hasMore });

        } catch (error) {
            console.error('Backend: Error fetching users:', error);
            res.status(500).json({ error: error.message || 'Failed to fetch users.' });
        }
    });

    // NEW: Customer Service Contact Management Endpoints

    // GET /api/admin/customer-service-contacts (Admin/Super Admin only)
    app.get('/admin/customer-service-contacts', authorizeAdmin(['super_admin', 'admin']), async (req, res) => {
        try {
            const snapshot = await db.collection('customer_service_contacts').orderBy('created_at', 'desc').get();
            const contacts = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                contacts.push({
                    id: doc.id,
                    number: data.number,
                    description: data.description,
                    is_active: data.is_active,
                    created_at: data.created_at ? data.created_at.toDate().toISOString() : null,
                    updated_at: data.updated_at ? data.updated_at.toDate().toISOString() : null,
                });
            });
            res.status(200).json({ contacts });
        } catch (error) {
            console.error('Backend: Error fetching customer service contacts:', error);
            res.status(500).json({ error: error.message || 'Failed to fetch contacts.' });
        }
    });

    // POST /api/admin/customer-service-contacts (Super Admin only)
    app.post('/admin/customer-service-contacts', authorizeAdmin(['super_admin']), async (req, res) => {
        try {
            const { number, description, is_active } = req.body;
            if (!number || !description) {
                return res.status(400).json({ error: 'Number and description are required.' });
            }

            const newContactRef = await db.collection('customer_service_contacts').add({
                number,
                description,
                is_active: typeof is_active === 'boolean' ? is_active : true, // Default to true if not provided
                created_at: admin.firestore.FieldValue.serverTimestamp(),
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log('Backend: New CS contact added with ID:', newContactRef.id);
            res.status(201).json({ message: 'Contact added successfully.', id: newContactRef.id });
        } catch (error) {
            console.error('Backend: Error adding customer service contact:', error);
            res.status(500).json({ error: error.message || 'Failed to add contact.' });
        }
    });

    // PUT /api/admin/customer-service-contacts/:contactId (Super Admin only)
    app.put('/admin/customer-service-contacts/:contactId', authorizeAdmin(['super_admin']), async (req, res) => {
        try {
            const { contactId } = req.params;
            const { number, description, is_active } = req.body;
            const updateData = {};

            if (number) updateData.number = number;
            if (description) updateData.description = description;
            if (typeof is_active === 'boolean') updateData.is_active = is_active;
            updateData.updated_at = admin.firestore.FieldValue.serverTimestamp();

            if (Object.keys(updateData).length === 1 && updateData.updated_at) { // Only updated_at, no actual changes
                return res.status(400).json({ error: 'No valid fields provided for update.' });
            }

            const contactDocRef = db.collection('customer_service_contacts').doc(contactId);
            await contactDocRef.update(updateData);
            console.log('Backend: CS contact updated with ID:', contactId, updateData);
            res.status(200).json({ message: 'Contact updated successfully.' });

        } catch (error) {
            console.error('Backend: Error updating customer service contact:', error);
            res.status(500).json({ error: error.message || 'Failed to update contact.' });
        }
    });

    // DELETE /api/admin/customer-service-contacts/:contactId (Super Admin only)
    app.delete('/admin/customer-service-contacts/:contactId', authorizeAdmin(['super_admin']), async (req, res) => {
        try {
            const { contactId } = req.params;

            if (!contactId) {
                return res.status(400).json({ error: 'Contact ID is required.' });
            }

            const contactDocRef = db.collection('customer_service_contacts').doc(contactId);
            await contactDocRef.delete();

            console.log(`Backend: Customer service contact ${contactId} deleted.`);
            res.status(200).json({ message: 'Contact deleted successfully.' });

        } catch (error) {
            console.error('Backend: Error deleting customer service contact:', error);
            res.status(500).json({ error: error.message || 'Failed to delete contact.' });
        }
    });

  
    // GET /api/customer-service/active: Get the active customer service number (publicly accessible)
    app.get('/customer-service/active', async (req, res) => {
        try {
            const snapshot = await db.collection('customer_service_contacts')
                .where('is_active', '==', true)
                .orderBy('updated_at', 'desc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log('Backend: No active customer service contact found.');
                return res.status(404).json({ message: 'No active customer service contact found.' });
            }

            const activeContact = snapshot.docs[0].data();
            res.status(200).json({ number: activeContact.number, description: activeContact.description });

        } catch (error) {
            console.error('Backend: Error fetching active customer service contact:', error);
            res.status(500).json({ error: error.message || 'Failed to fetch active contact.' });
        }
    });

// NEW: Utility Middleware for Authenticated User Access (any authenticated user)
const authorizeUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('Backend: Unauthorized access attempt: No Authorization header or malformed for user endpoint.');
        return res.status(401).json({ error: 'Unauthorized', message: 'No authentication token provided.' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken; // Attach decoded token to request for downstream use
        next(); // User is authenticated, proceed
    } catch (error) {
        console.error('Backend: Error verifying ID token for user endpoint:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication token.' });
    }
};

// NEW: API Endpoints for User Activity Dashboard
// These should be placed before the `exports.api = ...` line in your index.js file.

// GET /api/user-activity/:userId/summary: Get a user's activity summary
app.get('/user-activity/:userId/summary', authorizeUser, async (req, res) => {
    const { userId } = req.params;

    // Critical Security Check: Ensure the authenticated user is requesting their own data
    if (!req.user || req.user.uid !== userId) {
        console.warn(`Backend: Unauthorized attempt to access user summary for ${userId} by ${req.user ? req.user.uid : 'unauthenticated'}.`);
        return res.status(403).json({ error: 'Forbidden', message: 'You can only access your own user data.' });
    }

    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDocSnap = await userDocRef.get();

        if (!userDocSnap.exists) {
            console.warn(`Backend: User profile not found for summary for UID: ${userId}.`);
            return res.status(404).json({ error: 'Not Found', message: 'User profile not found.' });
        }

        const userData = userDocSnap.data();
        const summary = {
            userId: userData.userId,
            username: userData.username || 'User',
            email: userData.email,
            tier: userData.tier,
            selected_country: userData.selected_country || 'N/A',
            daily_numbers_shown: userData.daily_numbers_shown || 0,
            total_saved_numbers: userData.saved_numbers ? userData.saved_numbers.length : 0,
            hasSeenGuide:userData.hasSeenGuide,
            last_activity_date: userData.last_activity_date ? userData.last_activity_date.toDate().toISOString() : null,
            country_lock_date: userData.country_lock_date ? userData.country_lock_date.toDate().toISOString() : null,
        };

        res.status(200).json(summary);

    } catch (error) {
        console.error('Backend: Error fetching user activity summary:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch user activity summary.' });
    }
});

// GET /api/user-activity/:userId/numbers: Get a user's shown and saved numbers
app.get('/user-activity/:userId/numbers', authorizeUser, async (req, res) => {
    const { userId } = req.params;
    const type = req.query.type; // 'shown' or 'saved'
    const limit = parseInt(req.query.limit) || 20; // Default limit
    const startAfter = req.query.startAfter; // For pagination

    // Critical Security Check: Ensure the authenticated user is requesting their own data
    if (!req.user || req.user.uid !== userId) {
        console.warn(`Backend: Unauthorized attempt to access user numbers for ${userId} by ${req.user ? req.user.uid : 'unauthenticated'}.`);
        return res.status(403).json({ error: 'Forbidden', message: 'You can only access your own numbers data.' });
    }

    if (!type || (type !== 'shown' && type !== 'saved')) {
        return res.status(400).json({ error: 'Bad Request', message: 'Query parameter "type" must be "shown" or "saved".' });
    }

    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDocSnap = await userDocRef.get();

        if (!userDocSnap.exists) {
            console.warn(`Backend: User profile not found for numbers for UID: ${userId}.`);
            return res.status(404).json({ error: 'Not Found', message: 'User profile not found.' });
        }

        const userData = userDocSnap.data();
        let numbersList = [];

        if (type === 'shown') {
            numbersList = userData.shown_numbers || [];
        } else if (type === 'saved') {
            numbersList = userData.saved_numbers || [];
        }

        let startIndex = 0;
        if (startAfter) {
            const lastIndex = numbersList.lastIndexOf(startAfter);
            if (lastIndex !== -1) {
                startIndex = lastIndex + 1;
            }
        }

        const paginatedNumbers = numbersList.slice(startIndex, startIndex + limit);
        const hasMore = (startIndex + limit) < numbersList.length;
        const newStartAfter = hasMore ? paginatedNumbers[paginatedNumbers.length - 1] : null;

        res.status(200).json({
            numbers: paginatedNumbers,
            total: numbersList.length,
            hasMore: hasMore,
            startAfter: newStartAfter
        });

    } catch (error) {
        console.error('Backend: Error fetching user numbers:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch user numbers.' });
    }
});
    
    // Expose Express app as a Cloud Function
    exports.api = functions.https.onRequest(app);
    