// src/js/login.js

// Firebase Modular SDK Imports
import { initializeApp } from "firebase/app";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut // Including signOut for completeness, though less common on login page
} from "firebase/auth";
import {
    getFirestore,
    doc,
    setDoc
} from "firebase/firestore";

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

// Default user data for new signups
// This ensures that new user documents are created with a 'role: null' field from the start,
// which is important for satisfying Firebase Security Rules and role-based access.
const DEFAULT_USER_DATA_LOGIN = {
    tier: 'tier1',
    selected_country: null,
    daily_numbers_shown: 0,
    last_activity_date: null, // Will be set to new Date() on creation
    country_lock_date: null,
    saved_numbers: [],
    shown_numbers: [],
    email: null, // Will be overwritten with actual email on signup
   role: null, // Default role for new users
    hasSeenGuide: false

};

// --- UI Elements ---
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const signupBtn = document.getElementById('signup-btn');
const messageBox = document.getElementById('message-box');
const messageText = document.getElementById('message-text');

// Desktop message elements
const desktopMessage = document.querySelector('.desktop-message');
const loginContainer = document.getElementById('login-container');


// --- Utility Functions ---

/**
 * Displays a message in the message box.
 * @param {string} message The message to display.
 * @param {string} type The type of message ('success', 'error', 'warning', 'info').
 */
function showMessage(message, type = 'info') {
    messageText.textContent = message;
    messageBox.classList.remove('hidden', 'bg-green-100', 'border-green-400', 'text-green-700', 'bg-red-100', 'border-red-400', 'text-red-700', 'bg-yellow-100', 'border-yellow-400', 'text-yellow-700', 'bg-blue-100', 'border-blue-400', 'text-blue-700');
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
 * Handles user authentication (signup or login).
 * @param {boolean} isSignup True if it's a signup attempt, false for login.
 */
async function handleAuthentication(isSignup) {
    hideMessage(); // Clear previous messages
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        showMessage('Email and password cannot be empty.', 'warning');
        return;
    }
    if (password.length < 6) {
        showMessage('Password must be at least 6 characters long.', 'warning');
        return;
    }

    loginBtn.disabled = true;
    signupBtn.disabled = true;
    showMessage(isSignup ? 'Signing up...' : 'Logging in...', 'info');

    try {
        let userCredential;
        if (isSignup) {
            userCredential = await createUserWithEmailAndPassword(auth, email, password);
            // Create user document in Firestore upon successful signup
            const userDocRef = doc(db, `users/${userCredential.user.uid}`);
            const initialUserData = {
                ...DEFAULT_USER_DATA_LOGIN,
                userId: userCredential.user.uid,
                email: userCredential.user.email,
                last_activity_date: new Date() // Store as native Date object
            };
            await setDoc(userDocRef, initialUserData);
            showMessage('Signup successful! Redirecting...', 'success');
            console.log('Login: New user signed up and profile created in Firestore:', userCredential.user.uid);
        } else {
            userCredential = await signInWithEmailAndPassword(auth, email, password);
            showMessage('Login successful! Redirecting...', 'success');
            console.log('Login: User logged in:', userCredential.user.uid);
        }

        // Store user ID in local storage for other pages to pick up
        localStorage.setItem('whatsappUserData', JSON.stringify({ userId: userCredential.user.uid }));

        setTimeout(() => {
            window.location.href = 'index.html'; // Redirect to the main app page
        }, 1000);

    } catch (error) {
        console.error('Login: Authentication error:', error);
        let errorMessage = 'An unknown error occurred.';
        if (error.code) {
            switch (error.code) {
                case 'auth/invalid-email':
                    errorMessage = 'Invalid email address format.';
                    break;
                case 'auth/user-disabled':
                    errorMessage = 'This account has been disabled.';
                    break;
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                    errorMessage = 'Invalid email or password.';
                    break;
                case 'auth/email-already-in-use':
                    errorMessage = 'This email is already registered. Please log in.';
                    break;
                case 'auth/operation-not-allowed':
                    errorMessage = 'Email/password authentication is not enabled. Please contact support.';
                    break;
                case 'auth/weak-password':
                    errorMessage = 'Password is too weak. Must be at least 6 characters.';
                    break;
                default:
                    errorMessage = `Authentication failed: ${error.message}`;
            }
        }
        showMessage(errorMessage, 'error');
    } finally {
        loginBtn.disabled = false;
        signupBtn.disabled = false;
    }
}


// --- Event Listeners ---
loginBtn.addEventListener('click', () => handleAuthentication(false));
signupBtn.addEventListener('click', () => handleAuthentication(true));


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Check for desktop view and show message, preventing app load
    if (window.innerWidth > 767) {
        desktopMessage.style.display = 'flex'; // Show desktop message
        loginContainer.style.display = 'none'; // Hide login form
        console.log('Login: Detected desktop view. Showing desktop message.');
        return; // Stop further JS execution for desktop
    } else {
        desktopMessage.style.display = 'none'; // Hide desktop message
        loginContainer.style.display = 'flex'; // Show login form
        console.log('Login: Detected mobile view. Showing login form.');
    }

    // Listen for Firebase Auth state changes
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in, redirect to the main app page
            console.log('Login: User already authenticated, redirecting to main app.', user.uid);
            // Store user ID in local storage for other pages to pick up
            localStorage.setItem('whatsappUserData', JSON.stringify({ userId: user.uid }));
            window.location.href = 'index.html';
        } else {
            // No user is signed in, display the login form
            console.log('Login: No user authenticated, displaying login form.');
        }
    });
    console.log('Login: DOMContentLoaded - Waiting for Firebase Auth state.');
});
