// src/js/dashboard.js

// Firebase Modular SDK Imports
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import '../css/styles.css'; // Import global styles

// Firebase configuration (REPLACE WITH YOUR ACTUAL CONFIG)
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


// --- Global Constants (from mockData.js) ---
const TIER_LIMITS = {
    tier1: 8,
    tier2: 20,
    tier3: 50
};
const DEFAULT_USER_DATA = {
    userId: null,
    email: null,
    tier: 'tier1',
    username: null,
    selected_country: null,
    daily_numbers_shown: 0,
    last_activity_date: null,
    country_lock_date: null,
    saved_numbers: [],
    shown_numbers: [],
    role: null

};


// --- UI Elements ---
const pageTitle = document.getElementById('page-title');
const backButton = document.querySelector('header .app-button-gray');
const profileButton = document.querySelector('header .app-button-blue');
const numbersLeftSummary = document.getElementById('numbers-left-summary');
const totalSavedSummary = document.getElementById('total-saved-summary');
const showShownBtn = document.getElementById('show-shown-btn');
const showSavedBtn = document.getElementById('show-saved-btn');
const numbersTableBody = document.getElementById('numbers-table-body');
const currentYearSpan = document.getElementById('current-year');

// Initial loader elements
const initialLoaderOverlay = document.getElementById('initial-loader-overlay');
const appContainer = document.getElementById('app-container');
const desktopMessage = document.querySelector('.desktop-message');


// --- Global State ---
let currentFirebaseUser = null; // The authenticated user
let userData = {}; // Store user data for this page


// --- Backend API URL ---
const BACKEND_API_BASE_URL = 'https://us-central1-joe-2325.cloudfunctions.net/api';


// --- Utility Functions ---

/**
 * Hides the initial loading overlay and shows the app content.
 */
function hideInitialLoaderAndShowApp() {
    if (initialLoaderOverlay) {
        initialLoaderOverlay.classList.add('hidden');
    }
    if (appContainer) {
        appContainer.classList.remove('opacity-0', 'pointer-events-none');
    }
    document.body.classList.add('show-body'); // To handle initial FOUC
}

/**
 * Renders the numbers table with data.
 * @param {Array} numbers The list of numbers to display.
 * @param {string} type The type of numbers ('shown' or 'saved').
 */
function renderNumbersTable(numbers, type) {
    if (!numbers || numbers.length === 0) {
        numbersTableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-gray-500">No ${type} numbers found.</td></tr>`;
        return;
    }

    numbersTableBody.innerHTML = numbers.map(number => `
        <tr class="border-b border-gray-200 last:border-b-0">
            <td class="py-2 px-4 text-sm text-gray-700 font-mono">${number}</td>
            <td class="py-2 px-4 text-sm text-gray-700">
                <a href="https://wa.me/${number.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="app-button-green text-xs py-1 px-2">Chat</a>
            </td>
        </tr>
    `).join('');
}


// --- Core Logic ---

/**
 * Fetches and displays the user's activity summary from the backend.
 */
async function fetchUserSummary() {
    if (!currentFirebaseUser) return;

    try {
        const idToken = await currentFirebaseUser.getIdToken();
        const response = await fetch(`${BACKEND_API_BASE_URL}/user-activity/${currentFirebaseUser.uid}/summary`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.ok) {
            const summary = await response.json();
            numbersLeftSummary.textContent = summary.daily_numbers_shown ? (TIER_LIMITS[summary.tier] - summary.daily_numbers_shown) : TIER_LIMITS[summary.tier];
            totalSavedSummary.textContent = summary.total_saved_numbers;
            if (pageTitle) pageTitle.textContent = `${summary.username}'s Dashboard`;
            console.log('Dashboard: User summary fetched successfully.', summary);
        } else {
            console.error('Dashboard: Failed to fetch summary:', response.statusText);
        }
    } catch (error) {
        console.error('Dashboard: Error fetching user summary:', error);
    }
    
    await fetchUserNumbers('saved'); // Fetch saved numbers by default after summary
    hideInitialLoaderAndShowApp();
}

/**
 * Fetches and displays the user's shown or saved numbers.
 * @param {string} type 'shown' or 'saved'.
 */
async function fetchUserNumbers(type) {
    if (!currentFirebaseUser) return;
    numbersTableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4">Loading ${type} numbers...</td></tr>`;

    try {
        const idToken = await currentFirebaseUser.getIdToken();
        const response = await fetch(`${BACKEND_API_BASE_URL}/user-activity/${currentFirebaseUser.uid}/numbers?type=${type}`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            renderNumbersTable(data.numbers, type);
            console.log(`Dashboard: Fetched ${data.total} ${type} numbers.`);
        } else {
            const errorData = await response.json();
            console.error('Dashboard: Failed to fetch numbers:', errorData.message);
            numbersTableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-red-500">${errorData.message}</td></tr>`;
        }
    } catch (error) {
        console.error('Dashboard: Error fetching user numbers:', error);
        numbersTableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-red-500">Failed to load numbers.</td></tr>`;
    }
}


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Check for desktop view and show message, preventing app load
    if (window.innerWidth > 767) {
        if (desktopMessage) {
            desktopMessage.style.display = 'flex';
        }
        if (appContainer) {
            appContainer.style.display = 'none';
        }
        document.body.classList.add('show-body');
        return;
    } else {
        if (desktopMessage) desktopMessage.style.display = 'none';
        if (appContainer) {
            appContainer.style.display = 'flex';
            appContainer.classList.add('opacity-0', 'pointer-events-none');
        }
        if(initialLoaderOverlay) initialLoaderOverlay.classList.remove('hidden');
    }

    // Update current year in footer
    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }
    
    // Listen for Firebase Auth state changes
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentFirebaseUser = user;
            await fetchUserSummary();
            // User summary fetching will trigger the hideInitialLoaderAndShowApp
        } else {
            console.warn('Dashboard: No user authenticated. Redirecting to login.');
            window.location.href = 'login.html';
        }
    });

    // Attach button event listeners
    if (showShownBtn) {
        showShownBtn.addEventListener('click', () => fetchUserNumbers('shown'));
    }
    if (showSavedBtn) {
        showSavedBtn.addEventListener('click', () => fetchUserNumbers('saved'));
    }

    console.log('Dashboard: DOMContentLoaded finished.');
});
