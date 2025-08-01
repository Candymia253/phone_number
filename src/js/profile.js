// src/js/profile.js

// Import mock data and constants (needed for tier limits and default user data structure)
import { TIER_LIMITS, DEFAULT_USER_DATA } from './mockdata.js';

// Firebase Modular SDK Imports
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";

// Firebase configuration (REPLACE WITH YOUR ACTUAL CONFIG)
// This config must match the one in login.js, main.js, and admin.js
const firebaseConfig = {
     apiKey: "AIzaSyB7sYNElQi0e41l-pBp10O3HZ2-BkhjZog",
    authDomain: "joe-2325.firebaseapp.com",
    projectId: "joe-2325",
    storageBucket: "joe-2325.firebasestorage.app",
    messagingSenderId: "491551683586",
    appId: "1:491551683586:web:37650fffd7c3105e25e31b"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// --- UI Elements ---
const backToMainBtn = document.getElementById('back-to-main-btn');
const profileUserIdSpan = document.getElementById('profile-user-id');
const profileUserTierBadge = document.getElementById('profile-user-tier-badge');
const profileNumbersSavedSpan = document.getElementById('profile-numbers-saved');
const profileSelectedCountrySpan = document.getElementById('profile-selected-country');
const upgradeTier2Btn = document.getElementById('upgrade-tier2-btn');
const upgradeTier3Btn = document.getElementById('upgrade-tier3-btn');

// References to the tier card headers/spans for dynamic labels
const tier1CardHeader = document.getElementById('tier1-card-header');
const tier2CardHeader = document.getElementById('tier2-card-header');
const tier3CardHeader = document.getElementById('tier3-card-header');

// Reference to the Tier 1 button
const tier1UpgradeBtn = document.getElementById('tier1-upgrade-btn');

const messageBox = document.getElementById('message-box');
const messageText = document.getElementById('message-text');

// Customer Service Modal Elements
const customerServiceModal = document.getElementById('customer-service-modal');
const customerServiceMessage = document.getElementById('customer-service-message');
const contactWhatsappBtn = document.getElementById('contact-whatsapp-btn');
const closeCustomerServiceModalBtn = document.getElementById('close-customer-service-modal');

// Elements for initial page load
const initialLoaderOverlay = document.getElementById('initial-loader-overlay');
const appContainer = document.getElementById('app-container');
const desktopMessage = document.querySelector('.desktop-message');


// --- Global State ---
let userData = {}; // Will be loaded from Firestore
let currentFirebaseUser = null; // Stores the authenticated Firebase user object
let unsubscribeFromUserData = null; // To store the unsubscribe function for the Firestore listener
let activeCustomerServiceNumber = null; // Stores the fetched active customer service number


// --- Backend API URL ---
const BACKEND_API_BASE_URL = 'https://us-central1-joe-2325.cloudfunctions.net/api'; // Your backend server URL

// --- Utility Functions ---

/**
 * Displays a message in the message box.
 * @param {string} message The message to display.
 * @param {string} type The type of message ('success', 'error', 'warning', 'info').
 */
function showMessage(message, type = 'info') {
    messageText.textContent = message;
    messageBox.classList.remove('hidden', 'success', 'error', 'warning', 'info'); // Remove previous type classes
    switch (type) {
        case 'success':
            messageBox.classList.add('success'); // Use the class for styling
            break;
        case 'error':
            messageBox.classList.add('error');
            break;
        case 'warning':
            messageBox.classList.add('warning');
            break;
        case 'info':
        default:
            messageBox.classList.add('info');
            break;
    }
    messageBox.classList.remove('hidden');
}

/**
 * Hides the message box.
 */
function hideMessage() {
    messageBox.classList.add('hidden');
}

/**
 * Shows the custom customer service modal.
 * @param {string} errorMessage The error message to display in the modal.
 */
function showCustomerServiceModal(errorMessage) {
    customerServiceMessage.textContent = errorMessage;
    if (activeCustomerServiceNumber) {
        contactWhatsappBtn.href = `https://wa.me/${activeCustomerServiceNumber.replace(/\D/g, '')}`;
        contactWhatsappBtn.classList.remove('hidden'); // Show button if number exists
    } else {
        contactWhatsappBtn.classList.add('hidden'); // Hide button if no active number
    }
    customerServiceModal.classList.remove('hidden');
}

/**
 * Hides the custom customer service modal.
 */
function hideCustomerServiceModal() {
    customerServiceModal.classList.add('hidden');
}

/**
 * Converts a value to a native JavaScript Date object or null.
 * Handles Firestore Timestamps, ISO strings, null, and undefined.
 * @param {*} value The value to convert.
 * @returns {Date | null} A Date object or null.
 */
const convertToDateOrNull = (value) => {
    if (value instanceof Date) {
        return value;
    }
    if (value && typeof value.toDate === 'function') { // Firestore Timestamp object
        return value.toDate();
    }
    if (typeof value === 'string' && !isNaN(new Date(value).getTime())) {
        return new Date(value);
    }
    return null;
};

/**
 * Checks if a date (ISO string or Date object) is today.
 * @param {string | Date | null} date The date to check.
 * @returns {boolean} True if the date is today, false otherwise.
 */
function isToday(date) {
    if (!date) return false;
    const someDate = (typeof date === 'string') ? new Date(date) : date; // Still convert string to Date if needed
    const today = new Date();
    return someDate.getDate() === today.getDate() &&
           someDate.getMonth() === today.getMonth() &&
           someDate.getFullYear() === today.getFullYear();
}

/**
 * Calculates the date for the 1st of the next month.
 * @returns {string} Formatted date string for the 1st of the next month.
 */
function getFirstDayOfNextMonth() {
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return nextMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Fetches the active customer service number from the backend.
 * @returns {Promise<string|null>} The active WhatsApp number or null if not found.
 */
async function fetchActiveCustomerServiceNumber() {
    try {
        const response = await fetch(`${BACKEND_API_BASE_URL}/customer-service/active`);
        if (!response.ok) {
            console.warn('Profile page: No active customer service number found or backend error:', response.status);
            return null;
        }
        const data = await response.json();
        activeCustomerServiceNumber = data.number;
        console.log('Profile page: Active CS number fetched:', activeCustomerServiceNumber);
        return activeCustomerServiceNumber;
    } catch (error) {
        console.error('Profile page: Error fetching active customer service number:', error);
        return null;
    }
}


// --- User Data Management (Firestore Integration with Real-time Listener) ---

/**
 * Attaches a real-time listener to the user's document in Firestore.
 * This function will be called once upon authentication.
 */
async function setupUserDataListener() {
    if (!currentFirebaseUser || !currentFirebaseUser.uid) {
        console.error('Profile page: No authenticated Firebase user to set up listener for.');
        showMessage('Authentication error. Please log in again.', 'error');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return;
    }

    if (unsubscribeFromUserData) {
        unsubscribeFromUserData();
        console.log('Profile page: Unsubscribed from previous user data listener.');
    }

    const userDocRef = doc(db, `users/${currentFirebaseUser.uid}`);

    unsubscribeFromUserData = onSnapshot(userDocRef, async (docSnap) => {
        if (docSnap.exists()) {
            userData = docSnap.data();
            userData = { ...DEFAULT_USER_DATA, ...userData }; // Ensure all default properties exist

            // Convert Firestore Timestamp to native Date objects for local JS use
            userData.last_activity_date = convertToDateOrNull(userData.last_activity_date);
            userData.country_lock_date = convertToDateOrNull(userData.country_lock_date);

            // Daily reset logic is now primarily handled by backend on get-number request.
            // However, this client-side check ensures UI reflects correctly if user just opens app on new day.
            if (!isToday(userData.last_activity_date)) {
                // If it's a new day, reset client-side data and save to Firestore
                // This ensures UI is correct even before first get-number call.
                userData.daily_numbers_shown = 0;
                userData.shown_numbers = [];
                userData.last_activity_date = new Date(); // Assign a native Date object
                await saveUserDataToFirestore();
                showMessage("Daily limits reset! You have a fresh set of numbers.", "info");
                console.log('Profile page: Client-side daily limits reset and saved to Firestore.');
            }
            console.log('Profile page: User data received (real-time update):', userData);
            updateProfileUI(); // Always update UI on new data

            hideInitialLoaderAndShowContent();

        } else {
            // Document does not exist, create a new one for this user
            userData = {
                ...DEFAULT_USER_DATA,
                userId: currentFirebaseUser.uid,
                email: currentFirebaseUser.email || null,
                last_activity_date: new Date() // Assign a native Date object
            };
            await saveUserDataToFirestore();
            showMessage('Welcome! Your profile has been created.', 'success');
            console.log('Profile page: New user profile created in Firestore:', userData);
            updateProfileUI();

            hideInitialLoaderAndShowContent();
        }
    }, (error) => {
        console.error('Profile page: Error listening to user data:', error);
        showMessage('Failed to load real-time user data. Please refresh.', 'error');
        hideInitialLoaderAndShowContent(true);
    });
}

/**
 * Saves the current userData to Firestore.
 * It ensures date fields are converted to Date objects or null before saving.
 */
async function saveUserDataToFirestore() {
    if (!currentFirebaseUser || !currentFirebaseUser.uid) {
        console.error('Profile page: No authenticated Firebase user to save data for.');
        showMessage('Authentication error. Please log in again.', 'error');
        return;
    }
    const userDocRef = doc(db, `users/${currentFirebaseUser.uid}`);

    // Prepare data for Firestore by ensuring date fields are native Date objects or null
    const dataToSave = { ...userData };
    dataToSave.last_activity_date = convertToDateOrNull(dataToSave.last_activity_date);
    dataToSave.country_lock_date = convertToDateOrNull(dataToSave.country_lock_date);

    try {
        await setDoc(userDocRef, dataToSave);
        console.log('Profile page: User data saved to Firestore:', dataToSave);
    } catch (error) {
        console.error('Profile page: Error saving user data to Firestore:', error);
        showMessage('Failed to save user data.', 'error');
    }
}

function loadUserData() { /* No longer directly used, replaced by setupUserDataListener */ }
function saveUserData() { saveUserDataToFirestore(); }


// --- Initial Page Loader Control ---
/**
 * Hides the initial full-page loader and reveals the main app content.
 * @param {boolean} [showDesktopMessageOnly=false] If true, only shows the desktop message.
 */
function hideInitialLoaderAndShowContent(showDesktopMessageOnly = false) {
    initialLoaderOverlay.classList.add('hidden');

    if (window.innerWidth <= 767) {
        requestAnimationFrame(() => {
            if (!showDesktopMessageOnly) {
                console.log("Removing hidden styles from appContainer");
                appContainer.classList.remove('opacity-0', 'pointer-events-none');
            }
        });
    } else {
        desktopMessage.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
}


// --- UI Update Functions ---

/**
 * Updates the UI elements on the profile page based on current user data.
 */
function updateProfileUI() {
    if (!userData.userId) {
        profileUserIdSpan.textContent = 'N/A';
        profileUserTierBadge.textContent = 'N/A';
        profileNumbersSavedSpan.textContent = 'N/A';
        profileSelectedCountrySpan.textContent = 'N/A';
        console.warn('Profile page: User data not available for UI update.');
        return;
    }

    profileUserIdSpan.textContent = userData.userId;
    profileNumbersSavedSpan.textContent = userData.saved_numbers.length;
    profileSelectedCountrySpan.textContent = userData.selected_country || 'Not Selected';

    // Update tier badge
    profileUserTierBadge.textContent = userData.tier.toUpperCase();
    profileUserTierBadge.className = `tier-badge tier-badge-${userData.tier}`;
    console.log('Profile page: Updating UI for tier:', userData.tier);

    // --- Dynamic Tier Card Labels and Buttons ---

    // Reset all cards to default before applying current tier status
    tier1CardHeader.innerHTML = `Tier 1 <span class="text-sm font-normal text-gray-500"></span>`;
    tier2CardHeader.innerHTML = `Tier 2 <span class="text-sm font-normal text-gray-500">(Elite)</span>`;
    tier3CardHeader.innerHTML = `Tier 3 <span class="text-sm font-normal text-gray-500">(Master)</span>`;

    // Reset all upgrade/downgrade buttons to default state (enabled, original colors)
    tier1UpgradeBtn.textContent = 'Current Tier';
    tier1UpgradeBtn.classList.remove('app-button-blue', 'app-button-purple', 'app-button-red'); // Remove all possible dynamic colors
    tier1UpgradeBtn.classList.add('app-button-gray'); // Add default gray styling
    tier1UpgradeBtn.disabled = true;

    upgradeTier2Btn.textContent = 'Upgrade to Tier 2';
    upgradeTier2Btn.classList.remove('app-button-gray', 'app-button-blue', 'app-button-red');
    upgradeTier2Btn.classList.add('app-button-purple'); // Default upgrade color for Tier 2
    upgradeTier2Btn.disabled = false;

    upgradeTier3Btn.textContent = 'Upgrade to Tier 3';
    upgradeTier3Btn.classList.remove('app-button-gray', 'app-button-blue', 'app-button-purple');
    upgradeTier3Btn.classList.add('app-button-red'); // Default upgrade color for Tier 3
    upgradeTier3Btn.disabled = false;


    // Apply current tier specific styling and labels
    if (userData.tier === 'tier1') {
        tier1CardHeader.innerHTML = `Tier 1 <span class="text-sm font-normal text-gray-500">(Current Plan)</span>`;
        // tier1UpgradeBtn is already 'Current Tier' and disabled by the reset logic
    } else if (userData.tier === 'tier2') {
        tier2CardHeader.innerHTML = `Tier 2 <span class="text-sm font-normal text-gray-500">(Current Plan)</span>`;
        upgradeTier2Btn.textContent = 'Current Tier';
        upgradeTier2Btn.classList.remove('app-button-purple'); // Remove upgrade color
        upgradeTier2Btn.classList.add('app-button-gray'); // Add gray for current
        upgradeTier2Btn.disabled = true;

        tier1UpgradeBtn.textContent = 'Downgrade to Tier 1';
        tier1UpgradeBtn.classList.remove('app-button-gray'); // Remove gray styling
        tier1UpgradeBtn.classList.add('app-button-blue'); // Add blue styling for downgrade
        tier1UpgradeBtn.disabled = false;
    } else if (userData.tier === 'tier3') {
        tier3CardHeader.innerHTML = `Tier 3 <span class="text-sm font-normal text-gray-500">(Current Plan)</span>`;
        upgradeTier3Btn.textContent = 'Current Tier';
        upgradeTier3Btn.classList.remove('app-button-red'); // Remove upgrade color
        upgradeTier3Btn.classList.add('app-button-gray'); // Add gray for current
        upgradeTier3Btn.disabled = true;

        upgradeTier2Btn.textContent = 'Downgrade to Tier 2';
        upgradeTier2Btn.classList.remove('app-button-purple'); // Remove upgrade color
        upgradeTier2Btn.classList.add('app-button-blue'); // Add blue styling for downgrade
        upgradeTier2Btn.disabled = false;

        tier1UpgradeBtn.textContent = 'Downgrade to Tier 1';
        tier1UpgradeBtn.classList.remove('app-button-gray'); // Remove gray styling
        tier1UpgradeBtn.classList.add('app-button-blue'); // Add blue styling for downgrade
        tier1UpgradeBtn.disabled = false;
    }
}

// --- Core Logic ---

/**
 * Handles tier upgrade logic.
 * @param {string} newTier The tier to upgrade to ('tier1', 'tier2' or 'tier3').
 */
async function upgradeTier(newTier) {
    hideMessage(); // Hide any general messages
    hideCustomerServiceModal(); // Hide CS modal if it was open

    if (userData.tier === newTier) {
        showMessage(`You are already on ${newTier.toUpperCase()}!`, "info");
        return;
    }

    showMessage(`Attempting to change to ${newTier.toUpperCase()}...`, 'info');
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for UX

    try {
        const idToken = await currentFirebaseUser.getIdToken(); // Get ID token for authorization

        const response = await fetch(`${BACKEND_API_BASE_URL}/upgrade-tier`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}` // Send ID token
            },
            body: JSON.stringify({
                userId: currentFirebaseUser.uid,
                newTier: newTier
            })
        });

        if (!response.ok) {
            const contentType = response.headers.get("content-type");
            let errorData;
            if (contentType && contentType.indexOf("application/json") !== -1) {
                errorData = await response.json();
            } else {
                errorData = { message: await response.text() }; // Read as text if not JSON
            }
            // If 403 Forbidden, show custom CS modal
            if (response.status === 403) {
                showCustomerServiceModal(errorData.message || 'You do not have permission to change tiers.');
            } else {
                throw new Error(errorData.message || response.statusText);
            }
            return; // Stop execution after handling error response
        }

        const result = await response.json();
        showMessage(result.message, "success");
        console.log('Profile page: Tier change successful:', userData.tier, 'to', newTier);
        // UI update will be triggered by the onSnapshot listener from Firestore
        // No need for client-side userData update here, backend is authoritative

    } catch (error) {
        console.error('Profile page: Tier change failed:', error);
        // Show general error message or a specific modal for severe errors
        showCustomerServiceModal(`Tier change failed: ${error.message || 'An unknown error occurred.'}`);
    }
}

// --- Event Listeners ---
backToMainBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
});

tier1UpgradeBtn.addEventListener('click', () => {
    // Only call upgradeTier if not already on Tier 1
    if (userData.tier !== 'tier1') {
        upgradeTier('tier1');
    } else {
        showMessage('You are already on Tier 1!', 'info');
    }
});

upgradeTier2Btn.addEventListener('click', () => upgradeTier('tier2'));
upgradeTier3Btn.addEventListener('click', () => upgradeTier('tier3'));

closeCustomerServiceModalBtn.addEventListener('click', hideCustomerServiceModal);


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initial check for screen size to determine if app or desktop message should be shown
    if (window.innerWidth > 767) {
        desktopMessage.classList.remove('hidden');
        initialLoaderOverlay.classList.add('hidden');
        appContainer.classList.add('hidden');
        console.log('Profile page: Detected desktop view. Showing desktop message.');
        return;
    } else {
        initialLoaderOverlay.classList.remove('hidden');
        appContainer.classList.add('opacity-0', 'pointer-events-none');
        console.log('Profile page: Detected mobile view. Showing initial loader.');
    }

    // Fetch active customer service number on app load
    await fetchActiveCustomerServiceNumber();

    // Listen for Firebase Auth state changes
   onAuthStateChanged(auth, (user) => {
    if (user) {
        currentFirebaseUser = user;
        console.log('Profile page: Firebase user authenticated:', user.uid);
        setupUserDataListener();
    } else {
        console.warn('Profile page: No Firebase user authenticated. Redirecting to login.');
        showMessage('Session expired or not logged in. Redirecting to login.', 'warning');
        hideInitialLoaderAndShowContent(); // ← REMOVE the true param
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
    }
});

    console.log('Profile page: DOMContentLoaded - Waiting for Firebase Auth state.');
});
