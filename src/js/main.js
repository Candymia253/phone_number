// src/js/main.js

// Import mock data and constants (mockWhatsAppNumbers is no longer directly used for fetching, but TIER_LIMITS etc. still are)
import { TIER_LIMITS, AVAILABLE_COUNTRIES, DEFAULT_USER_DATA } from './mockdata.js';

// Firebase Modular SDK Imports
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";

// Firebase configuration (REPLACE WITH YOUR ACTUAL CONFIG)
// This config must match the one in login.js, profile.js, and admin.js
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
const userTierBadge = document.getElementById('user-tier-badge');
const numbersLeftSpan = document.getElementById('numbers-left');
const whatsappNumberDisplay = document.getElementById('whatsapp-number');
const numberStatusText = document.getElementById('number-status');
const saveNumberBtn = document.getElementById('save-number-btn');
const nextNumberBtn = document.getElementById('next-number-btn');
const copyNumberBtn = document.getElementById('copy-number-btn');
const whatsappChatBtn = document.getElementById('whatsapp-chat-btn');
const postSaveActionsDiv = document.getElementById('post-save-actions');
const messageBox = document.getElementById('message-box');
const messageText = document.getElementById('message-text');
const loadingIndicator = document.getElementById('loading-indicator'); // For in-app loading
const countrySelectionSection = document.getElementById('country-selection-section');
const countryButtonsDiv = document.getElementById('country-buttons');
const countryLockMessage = document.getElementById('country-lock-message');

// Elements for initial page load
const initialLoaderOverlay = document.getElementById('initial-loader-overlay');
const appContainer = document.getElementById('app-container');
const desktopMessage = document.querySelector('.desktop-message');
const currentDateEl = document.getElementById('current-date');

// Header elements
const userGreeting = document.getElementById('user-greeting');
const notificationsIcon = document.getElementById('notifications-icon');
const customerServiceIcon = document.getElementById('customer-service-icon');
const notificationBadge = document.getElementById('notification-badge');

// Quick Start Guide elements
const quickStartGuide = document.getElementById('quick-start-guide');
const closeGuideBtn = document.getElementById('close-guide-btn');

// --- Global State ---
let userData = {}; // Will be loaded from Firestore
let currentDisplayedNumber = null; // Stores the number currently shown on screen
let currentFirebaseUser = null; // Stores the authenticated Firebase user object
let unsubscribeFromUserData = null; // To store the unsubscribe function for the Firestore listener
let activeCustomerServiceNumber = null; // Stores the fetched active customer service number



/**
 * Sets the current date in a long, readable format.
 */
function setCurrentDate() {
    if (currentDateEl) {
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        currentDateEl.textContent = today.toLocaleDateString('en-US', options);
    }
}

/**
 * Masks an email address for display.
 * Shows the first 4 characters and replaces the rest with '***'.
 * @param {string} email The email to mask.
 * @returns {string} The masked email.
 */
function maskEmail(email) {
    if (!email || email.length <= 4) {
        return 'user****'; // Fallback for very short or null emails
    }
    return `${email.substring(0, 4)}****`;
}

/**
 * Updates the header UI with user-specific information.
 * @param {import("firebase/auth").User} user The authenticated Firebase user.
 */
function updateHeaderUI(user) {
    if (user && user.email) {
        const maskedEmail = maskEmail(user.email);
        if (userGreeting) {
            userGreeting.textContent = `Hi, ${maskedEmail}`;
        }
    }
}

/**
 * Sets up event listeners and dynamic links for the header.
 * NOTE: This function assumes you have a 'customer_service' collection
 * with a document 'default' containing a 'whatsappNumber' field.
 * You can adjust this to match your database structure.
 */
async function setupHeaderFunctionality() {
    // Notification Icon functionality
    if (notificationsIcon) {
        notificationsIcon.addEventListener('click', e => {
            e.preventDefault();
            showMessage('No new notifications.', 'info');
            if (notificationBadge) {
                notificationBadge.classList.add('hidden');
            }
        });
    }

    // Fetch and set customer service link
    if (customerServiceIcon) {
        // The customer service number is already fetched in DOMContentLoaded
        // and stored in activeCustomerServiceNumber. We just need to set the href.
        if (activeCustomerServiceNumber) {
            customerServiceIcon.href = `https://wa.me/${activeCustomerServiceNumber.replace(/\D/g, '')}`;
        } else {
            customerServiceIcon.href = '#'; // Fallback
            customerServiceIcon.addEventListener('click', e => {
                if (customerServiceIcon.href === '#') {
                    e.preventDefault();
                    showMessage('Customer service is currently unavailable.', 'warning');
                }
            });
        }
    }
}


// --- Backend API URL ---
const BACKEND_API_BASE_URL = 'https://us-central1-joe-2325.cloudfunctions.net/api'; // Your backend server URL

// --- Utility Functions ---

/**
 * Displays a message in the message box.
 * @param {string} message The message to display.
 * @param {string} type The type of message ('success', 'error', 'warning', 'info').
 */
function showMessage(message, type = 'info') {
    messageText.innerHTML = message; // Use innerHTML to allow for links
    messageBox.classList.remove('hidden', 'success', 'error', 'warning', 'info'); // Remove previous type classes
    switch (type) {
        case 'success':
            messageBox.classList.add('success');
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
 * Shows the loading indicator and disables action buttons.
 */
function showLoading() {
    loadingIndicator.classList.remove('hidden');
    saveNumberBtn.disabled = true;
    nextNumberBtn.disabled = true;
    copyNumberBtn.disabled = true;
    whatsappChatBtn.disabled = true;
    Array.from(countryButtonsDiv.children).forEach(button => button.disabled = true);
}

/**
 * Hides the loading indicator and re-enables action buttons based on state.
 */
function hideLoading() {
    loadingIndicator.classList.add('hidden');
    updateButtonStates();
    updateCountrySelectionUI();
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
 * Checks if a date (ISO string or Date object) is within the current calendar month.
 * @param {string | Date | null} date The date to check.
 * @returns {boolean} True if the date is in the current month, false otherwise.
 */
function isCurrentMonth(date) {
    if (!date) return false;
    const someDate = (typeof date === 'string') ? new Date(date) : date; // Still convert string to Date if needed
    const today = new Date();
    return someDate.getMonth() === today.getMonth() &&
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
            console.warn('Main app: No active customer service number found or backend error:', response.status);
            return null;
        }
        const data = await response.json();
        activeCustomerServiceNumber = data.number;
        console.log('Main app: Active CS number fetched:', activeCustomerServiceNumber);
        return activeCustomerServiceNumber;
    } catch (error) {
        console.error('Main app: Error fetching active customer service number:', error);
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
        console.error('Main app: No authenticated Firebase user to set up listener for.');
        showMessage('Authentication error. Please log in again.', 'error');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return;
    }

    if (unsubscribeFromUserData) {
        unsubscribeFromUserData();
        console.log('Main app: Unsubscribed from previous user data listener.');
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
                userData.daily_numbers_shown = 0;
                // Reset hasSeenGuide to false at the start of a new day
                if (userData.hasSeenGuide) {
                    userData.hasSeenGuide = false;
                }
                userData.shown_numbers = [];
                userData.last_activity_date = new Date(); // Assign a native Date object
                await saveUserDataToFirestore();
                showMessage("Daily limits reset! You have a fresh set of numbers.", "info");
                console.log('Main app: Client-side daily limits reset and saved to Firestore.');
            }
            console.log('Main app: User data received (real-time update):', userData);

            // --- Quick Start Guide Logic ---
            if (userData.hasSeenGuide === false) { // Explicitly check for false
                quickStartGuide.classList.remove('hidden');
            }

            updateUI();

            hideInitialLoaderAndShowContent();

        } else {
            // Document does not exist, create a new one for this user
            userData = {
                ...DEFAULT_USER_DATA,
                userId: currentFirebaseUser.uid,
                email: currentFirebaseUser.email || null,
                last_activity_date: new Date(), // Assign a native Date object
                hasSeenGuide: false // Explicitly set for new user
            };
            await saveUserDataToFirestore();
            showMessage('Welcome! Your profile has been created.', 'success');
            // Show the guide for new users
            quickStartGuide.classList.remove('hidden');
            console.log('Main app: New user profile created in Firestore:', userData);
            updateUI();

            hideInitialLoaderAndShowContent();
        }
    }, (error) => {
        console.error('Main app: Error listening to user data:', error);
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
        console.error('Main app: No authenticated Firebase user to save data for.');
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
        console.log('Main app: User data saved to Firestore:', dataToSave);
    } catch (error) {
        console.error('Main app: Error saving user data to Firestore:', error);
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
        if (!showDesktopMessageOnly) {
            appContainer.classList.remove('opacity-0', 'pointer-events-none');
        }
    } else {
        desktopMessage.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
}


// --- UI Update Functions ---
function updateUI() {

    userTierBadge.textContent = userData.tier.toUpperCase(); // Adjusted to match new HTML structure

    const numbersLeft = TIER_LIMITS[userData.tier] - userData.daily_numbers_shown;
    numbersLeftSpan.textContent = Math.max(0, numbersLeft);
    console.log('Main app: Numbers left:', numbersLeft);

    updateCountrySelectionUI();
    updateButtonStates();
}

function updateButtonStates() {
    const numbersLeft = TIER_LIMITS[userData.tier] - userData.daily_numbers_shown;
    const hasCountrySelected = userData.selected_country !== null;

    nextNumberBtn.disabled = (numbersLeft <= 0) || !hasCountrySelected;
    console.log('Main app: Next button disabled state:', nextNumberBtn.disabled, ' (Numbers left:', numbersLeft, 'Country selected:', hasCountrySelected, ')');

    if (!hasCountrySelected) {
        whatsappNumberDisplay.textContent = '---';
        numberStatusText.textContent = 'Select a country to begin';
    } else if (numbersLeft <= 0) {
        whatsappNumberDisplay.textContent = 'Limit Reached';
        numberStatusText.textContent = `You've used your daily limit for ${userData.tier.toUpperCase()} tier.`;
        const contactLink = activeCustomerServiceNumber
            ? `<a href="https://wa.me/${activeCustomerServiceNumber.replace(/\D/g, '')}" target="_blank" class="text-blue-700 underline">Contact Customer Service</a>`
            : '';
        showMessage(`You have reached your daily limit of ${TIER_LIMITS[userData.tier]} numbers. Upgrade your tier for more! ${contactLink}`, "warning");
        console.log('Main app: Daily limit reached for tier:', userData.tier);
        return;
    } else {
        saveNumberBtn.disabled = !currentDisplayedNumber || userData.saved_numbers.includes(currentDisplayedNumber);
    }

    if (currentDisplayedNumber && userData.saved_numbers.includes(currentDisplayedNumber)) {
        postSaveActionsDiv.classList.remove('hidden');
        copyNumberBtn.disabled = false;
        whatsappChatBtn.disabled = false;
        console.log('Main app: Post-save actions visible.');
    } else {
        postSaveActionsDiv.classList.add('hidden');
        console.log('Main app: Post-save actions hidden.');
    }
}


function updateCountrySelectionUI() {
    countryButtonsDiv.innerHTML = '';
    countryLockMessage.classList.add('hidden');

    AVAILABLE_COUNTRIES.forEach(country => {
        const button = document.createElement('button');
        button.textContent = country;
        // Apply consistent country button styling classes
        button.classList.add(
            'country-btn', 'country-btn-default' // Base and default state classes
        );


        const isSelected = userData.selected_country === country;
        let isDisabled = false;
        let tempLockMessage = '';

        if (userData.tier === 'tier1' || userData.tier === 'tier2') {
            if (userData.selected_country && !isCurrentMonth(userData.country_lock_date)) {
                userData.selected_country = null;
                userData.country_lock_date = null;
                saveUserData();
                showMessage(`New month! You can now select a new country.`, 'info');
                console.log('Main app: Country lock reset for new month.');
            } else if (userData.selected_country && userData.selected_country !== country) {
                isDisabled = true;
                tempLockMessage = `Your country is locked to ${userData.selected_country} until ${getFirstDayOfNextMonth()}.`;
            }
        }
        else if (userData.tier === 'tier3') {
            if (userData.selected_country && userData.selected_country !== country && userData.daily_numbers_shown < TIER_LIMITS.tier3) {
                isDisabled = true;
                tempLockMessage = `You must use all ${TIER_LIMITS.tier3} daily numbers before changing country.` ;
            }
        }

        if (isSelected) {
            button.classList.remove('country-btn-default');
            button.classList.add('country-btn-selected');
            button.disabled = true;
            console.log(`Main app: Country button for ${country} is selected and disabled.`);
        } else if (isDisabled) {
            button.classList.remove('country-btn-default');
            button.classList.add('country-btn-disabled');
            button.disabled = true;
            console.log(`Main app: Country button for ${country} is disabled with message: "${tempLockMessage}"`);
        } else {
            button.disabled = false;
            button.addEventListener('click', () => selectCountry(country));
            console.log(`Main app: Country button for ${country} is enabled.`);
        }
        countryButtonsDiv.appendChild(button);

        if (tempLockMessage) {
            countryLockMessage.textContent = tempLockMessage;
            countryLockMessage.classList.remove('hidden');
        } else if (!userData.selected_country && countryLockMessage.classList.contains('hidden')) {
            countryLockMessage.textContent = 'Please select a country to get numbers.';
            countryLockMessage.classList.remove('hidden');
        }
    });

    if (!userData.selected_country && countryLockMessage.classList.contains('hidden')) {
        countryLockMessage.textContent = 'Please select a country to get numbers.';
        countryLockMessage.classList.remove('hidden');
    }
}


// --- Core Application Logic ---

/**
 * Handles country selection.
 * @param {string} country The country selected by the user.
 */
async function selectCountry(country) {
    hideMessage();
    showLoading(); // Show in-app loading indicator
    await new Promise(resolve => setTimeout(resolve, 300));

    if (userData.selected_country === country) {
        showMessage(`You have already selected ${country}.`, 'info');
        hideLoading();
        return;
    }

    if (userData.tier === 'tier3' && userData.selected_country !== null && userData.daily_numbers_shown < TIER_LIMITS.tier3) {
        showMessage(`Master tier (Tier 3): You must use all ${TIER_LIMITS.tier3} daily numbers before changing country.`, 'warning');
        console.log('Main app: Master tier country change denied - daily limit not exhausted.');
        hideLoading();
        return;
    }

    userData.selected_country = country;
    userData.country_lock_date = new Date(); // Assign a native Date object
    saveUserData(); // This calls saveUserDataToFirestore
    showMessage(`Country set to ${country}.`, 'success');
    console.log('Main app: Country selected:', userData.selected_country, 'Lock date:', userData.country_lock_date);
    updateUI();
    hideLoading();
}


/**
 * Fetches and displays a new WhatsApp number based on user's tier and selected country.
 */
async function getNextNumber() {
    hideMessage();
    showLoading(); // Show in-app loading indicator
    whatsappNumberDisplay.textContent = 'Loading...';
    numberStatusText.textContent = 'Fetching new number...';
    postSaveActionsDiv.classList.add('hidden');
    currentDisplayedNumber = null;

    if (!userData.selected_country) {
        showMessage("Please select a country first.", "warning");
        whatsappNumberDisplay.textContent = '---';
        numberStatusText.textContent = 'Select a country to begin';
        hideLoading();
        console.log('Main app: Cannot get number, no country selected.');
        return;
    }

    // Daily limit check is now primarily handled by the backend.
    // This frontend check provides immediate feedback, but backend is authoritative.
    const currentTierLimit = TIER_LIMITS[userData.tier];
    if (userData.daily_numbers_shown >= currentTierLimit) {
        whatsappNumberDisplay.textContent = 'Limit Reached';
        numberStatusText.textContent = `You've used your daily limit for ${userData.tier.toUpperCase()} tier.`;
        // Use activeCustomerServiceNumber if available for the link
        const contactLink = activeCustomerServiceNumber
            ? `<a href="https://wa.me/${activeCustomerServiceNumber.replace(/\D/g, '')}" target="_blank" class="text-blue-700 underline">Contact Customer Service</a>`
            : '';
        showMessage(`You have reached your daily limit of ${currentTierLimit} numbers. Upgrade your tier for more! ${contactLink}`, "warning");
        hideLoading();
        console.log('Main app: Daily limit reached for tier:', userData.tier);
        return;
    }

    try {
        console.log(userData.selected_country)
        const response = await fetch(`${BACKEND_API_BASE_URL}/get-number?tier=${userData.tier}&country=${userData.selected_country}&userId=${currentFirebaseUser.uid}`);

        if (!response.ok) {
            const contentType = response.headers.get("content-type");
            let errorData;
            if (contentType && contentType.indexOf("application/json") !== -1) {
                errorData = await response.json();
            } else {
                errorData = { message: await response.text() };
            }
            // Use activeCustomerServiceNumber if available for the link in error messages
            const contactLink = activeCustomerServiceNumber
                ? `<a href="https://wa.me/${activeCustomerServiceNumber.replace(/\D/g, '')}" target="_blank" class="text-blue-700 underline">Contact Customer Service</a>`
                : '';

            if (response.status === 403) { // Forbidden: Daily limit reached
                showMessage(`${errorData.message} ${contactLink}`, 'warning');
                whatsappNumberDisplay.textContent = 'Limit Reached';
                numberStatusText.textContent = `You've used your daily limit for ${userData.tier.toUpperCase()} tier.`;
            } else if (response.status === 404) { // Not Found: No unique numbers
                showMessage(`${errorData.message} ${contactLink}`, 'info'); // Add contact link here
                whatsappNumberDisplay.textContent = 'No New Numbers';
                numberStatusText.innerHTML = `No more unique numbers available for your tier/country today. ${contactLink}`; // Changed to innerHTML and added contactLink
                console.log(response.status)
            }  else {
                throw new Error(errorData.message || response.statusText);
            }
            return; // Stop execution after handling error response
        }

        const data = await response.json();
        const newNumber = data.number;

        currentDisplayedNumber = newNumber;
        whatsappNumberDisplay.textContent = newNumber;
        numberStatusText.textContent = 'New number displayed!';

        console.log('Main app: New number generated from backend:', newNumber);

    } catch (error) {
        console.error('Main app: Error fetching number from backend:', error);
        whatsappNumberDisplay.textContent = 'Error';
        numberStatusText.textContent = 'Failed to fetch number.';
        showMessage(`Error: ${error.message || 'Could not fetch number from backend.'}`, 'error');
        currentDisplayedNumber = null;
        postSaveActionsDiv.classList.add('hidden');
    } finally {
        hideLoading(); // Hide in-app loading indicator
    }
}

/**
 * Saves the currently displayed number to the user's saved_numbers in Firestore.
 */
async function saveCurrentNumber() {
    hideMessage();
    if (!currentDisplayedNumber) {
        showMessage("No valid number to save.", "warning");
        console.log('Main app: Attempted to save, but no number displayed.');
        return;
    }

    showLoading();
    try {
        const response = await fetch(`${BACKEND_API_BASE_URL}/save-number`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                number: currentDisplayedNumber,
                userId: currentFirebaseUser.uid
            })
        });

        if (!response.ok) {
            const contentType = response.headers.get("content-type");
            let errorData;
            if (contentType && contentType.indexOf("application/json") !== -1) {
                errorData = await response.json();
            } else {
                errorData = { message: await response.text() };
            }
            throw new Error(errorData.error || errorData.message || response.statusText);
        }

        showMessage(`Number ${currentDisplayedNumber} saved successfully!`, "success");
        console.log('Main app: Number saved via backend:', currentDisplayedNumber);

    } catch (error) {
        console.error('Main app: Error saving number via backend:', error);
        showMessage(`Error: ${error.message || 'Could not save number.'}`, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Copies the currently displayed number to the clipboard.
 */
function copyNumberToClipboard() {
    if (!currentDisplayedNumber) {
        showMessage("No number to copy.", "warning");
        return;
    }

    const tempInput = document.createElement('textarea');
    tempInput.value = currentDisplayedNumber;
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
        document.execCommand('copy');
        showMessage(`Copied "${currentDisplayedNumber}" to clipboard!`, 'success');
        console.log('Main app: Number copied to clipboard:', currentDisplayedNumber);
    } catch (err) {
        console.error('Main app: Failed to copy text:', err);
        showMessage('Failed to copy number. Please try manually.', 'error');
    }
    document.body.removeChild(tempInput);
}

/**
 * Opens a WhatsApp chat link for the currently displayed number.
 */
function chatOnWhatsApp() {
    if (!currentDisplayedNumber) {
        showMessage("No number to chat with.", "warning");
        return;
    }
    const cleanedNumber = currentDisplayedNumber.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${cleanedNumber}`;
    window.open(whatsappUrl, '_blank');
    showMessage(`Opening WhatsApp chat for ${currentDisplayedNumber}...`, 'info');
    console.log('Main app: Opening WhatsApp chat for:', currentDisplayedNumber);
}

// --- Event Listeners ---
nextNumberBtn.addEventListener('click', getNextNumber);
saveNumberBtn.addEventListener('click', saveCurrentNumber);
copyNumberBtn.addEventListener('click', copyNumberToClipboard);
closeGuideBtn.addEventListener('click', async () => {
    quickStartGuide.classList.add('hidden');
    if (currentFirebaseUser) {
        // Update the flag in the local state and save it to Firestore
        userData.hasSeenGuide = true;
        await saveUserDataToFirestore();
        console.log('Main app: User has dismissed the guide. Flag set to true.');
    }
});
whatsappChatBtn.addEventListener('click', chatOnWhatsApp);

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    if (window.innerWidth > 767) {
        desktopMessage.classList.remove('hidden');
        initialLoaderOverlay.classList.add('hidden');
        appContainer.classList.add('hidden');
        console.log('Main app: Detected desktop view. Showing desktop message.');
        return;
    } else {
        initialLoaderOverlay.classList.remove('hidden');
        appContainer.classList.add('opacity-0', 'pointer-events-none');
        console.log('Main app: Detected mobile view. Showing initial loader.');
    }

    // Fetch active customer service number on app load
    await fetchActiveCustomerServiceNumber();

    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentFirebaseUser = user;
            updateHeaderUI(user); // Update the header with the user's email
            setCurrentDate(); // Set the date in the UI
            console.log('Main app: Firebase user authenticated:', user.uid);
            setupUserDataListener();
        } else {
            console.warn('Main app: No Firebase user authenticated. Redirecting to login.');
            showMessage('Session expired or not logged in. Redirecting to login.', 'warning');
            hideInitialLoaderAndShowContent(true);
            setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        }
    });
    console.log('Main app: DOMContentLoaded - Waiting for Firebase Auth state.');
});
