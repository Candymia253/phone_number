// src/js/admin.js

// Firebase Modular SDK Imports
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, deleteDoc } from "firebase/firestore";

// Firebase configuration (REPLACE WITH YOUR ACTUAL CONFIG)
// This config must match the one in login.js, main.js, and profile.js
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
const initialLoaderOverlay = document.getElementById('initial-loader-overlay');
const appContainer = document.getElementById('app-container');
const desktopMessage = document.querySelector('.desktop-message');
const countrySelect = document.getElementById('country-select');
const tierSelect = document.getElementById('tier-select');
const numbersTextarea = document.getElementById('numbers-textarea');
const sourceBatchIdInput = document.getElementById('source-batch-id');
const uploadBatchBtn = document.getElementById('upload-batch-btn');
const messageBox = document.getElementById('message-box');
const messageText = document.getElementById('message-text');
const viewUsersBtn = document.getElementById('view-users-btn');
console.log('Admin Panel: View Users Button:', viewUsersBtn);
const logoutBtn = document.getElementById('logout-btn');

// User Management UI Elements (Dynamically created in DOMContentLoaded)
let userListContainer;
let userListBody;
let userPaginationDiv;
let prevUsersBtn;
let nextUsersBtn;

// User Management Modal Elements (Dynamically created and appended in DOMContentLoaded)
let userModal; // Global reference to the modal DIV
let modalUserIdSpan;
let modalTierSelect;
let modalRoleSelect;
let modalCancelBtn;
let modalSaveBtn;


// Customer Service Management UI Elements (Selected from static HTML or dynamically created)
const viewCsContactsBtn = document.getElementById('view-cs-contacts-btn');
let csListBody; // Will be assigned in DOMContentLoaded
const csTableWrapper = document.getElementById('cs-table-wrapper');
const addCsContactBtn = document.getElementById('add-cs-contact-btn');

// Customer Service Management Modal Elements (Dynamically created and appended in DOMContentLoaded)
let csContactModal; // Global reference to the modal DIV
let csModalTitle;
let csModalNumber;
let csModalDescription;
let csModalActive;
let csModalCancelBtn;
let csModalSaveBtn;


// --- Backend API URL ---
const BACKEND_API_BASE_URL = 'https://us-central1-joe-2325.cloudfunctions.net/api'; // Your backend server URL

// --- Global State ---
let currentFirebaseUser = null; // Stores the authenticated Firebase user object
let lastFetchedUserId = null; // For pagination of user list
let hasMoreUsers = true; // To track if there are more users to fetch
let currentUserRole = null; // To store the role of the current authenticated user
let userToManageId = null; // Stores the ID of the user currently being managed in the modal
let csContactToManageId = null; // Stores the ID of the CS contact currently being managed in the modal


// --- Utility Functions ---

/**
 * Displays a message in the message box.
 * @param {string} message The message to display.
 * @param {string} type The type of message ('success', 'error', 'warning', 'info').
 */
function showMessage(message, type = 'info') {
    messageText.textContent = message;
    messageBox.classList.remove('hidden', 'success', 'error', 'warning', 'info');
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
 * Shows/hides loading states for the upload button.
 * @param {boolean} isLoading
 */
function setUploadLoadingState(isLoading) {
    if (isLoading) {
        uploadBatchBtn.disabled = true;
        uploadBatchBtn.textContent = 'Uploading...';
        uploadBatchBtn.classList.add('opacity-70', 'cursor-not-allowed');
    } else {
        uploadBatchBtn.disabled = false;
        uploadBatchBtn.textContent = 'Upload Batch';
        uploadBatchBtn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
}

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

/**
 * Robustly parses API response, handling non-JSON content.
 * @param {Response} response The fetch API response.
 * @returns {Promise<object>} Parsed JSON data or an error object with a message.
 */
async function parseResponse(response) {
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        return await response.json();
    } else {
        const text = await response.text();
        return { message: text || response.statusText };
    }
}

// --- Admin Authentication & Authorization ---

/**
 * Checks if the current user is an admin and sets their role.
 * @param {string} userId The Firebase UID of the user.
 * @returns {Promise<string|null>} The user's role (e.g., 'super_admin', 'admin', 'number_uploader') or null if not an admin.
 */
async function getUserRole(userId) {
    if (!userId) return null;
    try {
        const userDocRef = doc(db, `users/${userId}`);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            if (userData.role) {
                return userData.role;
            } else if (userData.is_admin === true) {
                return 'admin'; // Generic admin if only is_admin is present
            }
            return null; // Not an admin role
        }
        return null;
    } catch (error) {
        console.error('Admin Panel: Error checking user role:', error);
        return null;
    }
}

/**
 * Handles user logout.
 */
async function handleLogout() {
    try {
        await signOut(auth);
        localStorage.removeItem('whatsappUserData'); // Clear local user data
        showMessage('Logged out successfully. Redirecting...', 'success');
        setTimeout(() => {
            window.location.href = 'login.html'; // Redirect to login page
        }, 1000);
    }
    catch (error) {
        console.error('Admin Panel: Logout Error:', error);
        showMessage('Failed to log out. Please try again.', 'error');
    }
}

// --- Batch Upload Logic ---

/**
 * Handles the batch upload process.
 */
async function handleBatchUpload() {
    hideMessage();
    setUploadLoadingState(true);

    if (currentUserRole !== 'super_admin' && currentUserRole !== 'admin') {
        showMessage('Access Denied: You need Admin or Super Admin role to upload batches.', 'error');
        setUploadLoadingState(false);
        return;
    }

    const country = countrySelect.value;
    const tier = tierSelect.value;
    const numbersRaw = numbersTextarea.value;
    const sourceBatchId = sourceBatchIdInput.value.trim();

    if (!country) {
        showMessage('Please select a country.', 'warning');
        setUploadLoadingState(false);
        return;
    }
    if (!tier) {
        showMessage('Please select a tier.', 'warning');
        setUploadLoadingState(false);
        return;
    }
    const numbers = numbersRaw.split('\n').map(num => num.trim()).filter(num => num !== '');
    if (numbers.length === 0) {
        showMessage('Please enter WhatsApp numbers, one per line.', 'warning');
        setUploadLoadingState(false);
        return;
    }

    try {
        const idToken = await currentFirebaseUser.getIdToken();

        const response = await fetch(`${BACKEND_API_BASE_URL}/upload-batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                country: country,
                tier: tier,
                numbers: numbers,
                source_batch_id: sourceBatchId || null
            })
        });

        if (!response.ok) {
            const errorData = await parseResponse(response);
            throw new Error(errorData.error || errorData.message || response.statusText);
        }

        const result = await response.json();
        showMessage(result.message, 'success');
        numbersTextarea.value = '';
        sourceBatchIdInput.value = '';

    } catch (error) {
        console.error('Admin Panel: Batch upload failed:', error);
        showMessage(`Upload failed: ${error.message || 'An unknown error occurred.'}`, 'error');
    } finally {
        setUploadLoadingState(false);
    }
}

// --- User Management Logic ---

/**
 * Fetches and displays users from the backend.
 * @param {string | null} startAfterUserId User ID to start fetching after for pagination.
 */
async function fetchAndDisplayUsers(startAfterUserId = null) {
    hideMessage();
    if (currentUserRole !== 'super_admin') {
        showMessage('Access Denied: Only Super Admins can view and manage users.', 'error');
        userListBody.innerHTML = '<p class="text-center py-4 text-red-500">Access Denied: Super Admin role required.</p>';
        prevUsersBtn.disabled = true;
        nextUsersBtn.disabled = true;
        return;
    }

    showMessage('Fetching users...', 'info');
    userListBody.innerHTML = '<p class="text-center py-4 text-gray-500">Loading users...</p>';
    prevUsersBtn.disabled = true;
    nextUsersBtn.disabled = true;

    try {
        let url = `${BACKEND_API_BASE_URL}/users?limit=10`;
        if (startAfterUserId) {
            url += `&startAfter=${startAfterUserId}`;
        }
        console.log('Admin Panel: Fetching users from:', url);

        const idToken = await currentFirebaseUser.getIdToken();

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            const errorData = await parseResponse(response);
            throw new Error(errorData.error || errorData.message || response.statusText);
        }

        const data = await response.json();
        const users = data.users;
        lastFetchedUserId = data.lastUser;
        hasMoreUsers = data.hasMore;

        console.log('Admin Panel: Fetched users:', users);

        userListBody.innerHTML = '';

        if (users.length === 0) {
            userListBody.innerHTML = '<p class="text-center py-4 text-gray-500">No users found.</p>';
            showMessage('No users found.', 'info');
            prevUsersBtn.disabled = true;
            nextUsersBtn.disabled = true;
            return;
        }

        users.forEach(user => { // Create a card for each user
            const card = document.createElement('div');
            card.classList.add('bg-white', 'p-4', 'rounded-lg', 'shadow', 'border', 'border-gray-200');
            card.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <p class="text-xs text-gray-500">User ID</p>
                        <p class="font-mono text-xs text-gray-800" title="${user.userId}">${user.userId.substring(0, 12)}...</p>
                    </div>
                    <span class="tier-badge tier-badge-${user.tier || 'tier1'}">${user.tier || 'N/A'}</span>
                </div>
                <div class="mb-3">
                    <p class="text-xs text-gray-500">Email</p>
                    <p class="font-medium text-gray-800 truncate" title="${user.email || 'N/A'}">${user.email || 'N/A'}</p>
                </div>
                <div class="grid grid-cols-2 gap-4 text-center border-t border-b border-gray-100 py-3 my-3">
                    <div>
                        <p class="text-xs text-gray-500">Daily Shown</p>
                        <p class="font-bold text-lg text-gray-800">${user.daily_numbers_shown || 0}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Total Saved</p>
                        <p class="font-bold text-lg text-gray-800">${user.saved_numbers ? user.saved_numbers.length : 0}</p>
                    </div>
                </div>
                ${currentUserRole === 'super_admin' ?
                    `<button class="manage-user-btn app-button app-button-blue w-full py-2 text-sm" data-user-id="${user.userId}" data-user-tier="${user.tier}" data-user-role="${user.role || ''}">Manage User</button>`
                    : `<p class="text-center text-xs text-gray-400 mt-2">Admin role required to manage.</p>`
                }
            `;
            userListBody.appendChild(card);
        });

        showMessage(`Successfully loaded ${users.length} users.`, 'success');

        document.querySelectorAll('.manage-user-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                const userId = event.target.dataset.userId;
                const userTier = event.target.dataset.userTier;
                const userRole = event.target.dataset.userRole;
                openManageUserModal(userId, userTier, userRole);
            });
        });

        prevUsersBtn.disabled = (startAfterUserId === null);
        nextUsersBtn.disabled = !hasMoreUsers;

    } catch (error) {
        console.error('Admin Panel: Error fetching users:', error);
        showMessage(`Failed to load users: ${error.message || 'An unknown error occurred.'}`, 'error');
        userListBody.innerHTML = '<p class="text-center py-4 text-red-500">Error loading users.</p>';
    }
}

/**
 * Opens the modal to manage a specific user.
 * @param {string} userId
 * @param {string} currentTier
 * @param {string} currentRole
 */
function openManageUserModal(userId, currentTier, currentRole) {
    userToManageId = userId;
    modalUserIdSpan.textContent = userId;
    modalTierSelect.value = currentTier;
    modalRoleSelect.value = currentRole;

    userModal.classList.remove('hidden');
}

/**
 * Closes the user management modal.
 */
function closeManageUserModal() {
    userModal.classList.add('hidden');
    userToManageId = null;
    hideMessage();
}

/**
 * Handles saving changes from the user management modal.
 */
async function saveUserChanges() {
    hideMessage();
    if (!userToManageId) {
        showMessage('No user selected for management.', 'error');
        closeManageUserModal();
        return;
    }

    const newTier = modalTierSelect.value;
    const newRole = modalRoleSelect.value === '' ? null : modalRoleSelect.value;

    if (!newTier) {
        showMessage('Please select a tier for the user.', 'warning');
        return;
    }

    const updateData = {
        tier: newTier,
        role: newRole
    };

    showMessage('Saving user changes...', 'info');
    modalSaveBtn.disabled = true;

    try {
        const idToken = await currentFirebaseUser.getIdToken();

        const response = await fetch(`${BACKEND_API_BASE_URL}/users/${userToManageId}/manage`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(updateData)
        });

        if (!response.ok) {
            const errorData = await parseResponse(response);
            throw new Error(errorData.error || errorData.message || response.statusText);
        }

        const result = await response.json();
        showMessage(result.message, 'success');
        closeManageUserModal();
        fetchAndDisplayUsers();

    } catch (error) {
        console.error('Admin Panel: Failed to save user changes:', error);
        showMessage(`Failed to save changes: ${error.message || 'An unknown error occurred.'}`, 'error');
    } finally {
        modalSaveBtn.disabled = false;
    }
}


// --- Customer Service Contact Management Logic ---

/**
 * Fetches and displays customer service contacts.
 */
async function fetchAndDisplayCsContacts() {
    hideMessage();
    if (currentUserRole !== 'super_admin' && currentUserRole !== 'admin') { // Admin can view contacts too
        showMessage('Access Denied: You need Admin or Super Admin role to view contacts.', 'error');
        csListBody.innerHTML = '<p class="text-center py-4 text-red-500">Access Denied: Admin or Super Admin role required.</p>';
        addCsContactBtn.disabled = true; // Disable add button for non-super-admins
        return;
    }
    // Only Super Admins can add/edit/delete
    addCsContactBtn.disabled = (currentUserRole !== 'super_admin');

    showMessage('Fetching contacts...', 'info');
    csListBody.innerHTML = '<p class="text-center py-4 text-gray-500">Loading contacts...</p>';

    try {
        const idToken = await currentFirebaseUser.getIdToken();
        const response = await fetch(`${BACKEND_API_BASE_URL}/admin/customer-service-contacts`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!response.ok) {
            const errorData = await parseResponse(response);
            throw new Error(errorData.error || errorData.message || response.statusText);
        }

        const data = await response.json();
        const contacts = data.contacts;

        console.log('Admin Panel: Fetched CS contacts:', contacts);

        csListBody.innerHTML = '';

        if (contacts.length === 0) {
            csListBody.innerHTML = '<p class="text-center py-4 text-gray-500">No contacts found. Click "Add New Contact" to create one.</p>';
            showMessage('No customer service contacts found.', 'info');
            return;
        }

        contacts.forEach(contact => {
            const card = document.createElement('div');
            card.classList.add('bg-white', 'p-4', 'rounded-lg', 'shadow', 'border', 'border-gray-200');
            card.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <p class="text-xs text-gray-500">Number</p>
                        <p class="font-bold text-gray-800">${contact.number}</p>
                    </div>
                    <div class="flex items-center space-x-2">
                        <label for="toggle-${contact.id}" class="text-sm font-medium text-gray-600">Active</label>
                        <input type="checkbox" id="toggle-${contact.id}" class="cs-active-toggle h-5 w-5 text-blue-600 rounded focus:ring-blue-500" ${contact.is_active ? 'checked' : ''} ${currentUserRole !== 'super_admin' ? 'disabled' : ''}>
                    </div>
                </div>
                <div class="mb-4">
                    <p class="text-xs text-gray-500">Description</p>
                    <p class="font-medium text-gray-800">${contact.description}</p>
                </div>
                ${currentUserRole === 'super_admin' ? `
                <div class="flex items-center space-x-2 border-t border-gray-100 pt-3 mt-3">
                    <button class="edit-cs-contact-btn app-button app-button-yellow w-full py-2 text-sm">Edit</button>
                    <button class="delete-cs-contact-btn app-button app-button-red w-full py-2 text-sm">Delete</button>
                </div>
                ` : ''}
            `;
            // Store data on the card element for event listeners
            card.dataset.contactId = contact.id;
            card.dataset.contactNumber = contact.number;
            card.dataset.contactDescription = contact.description;
            card.dataset.contactActive = contact.is_active;
            csListBody.appendChild(card);
        });
        showMessage(`Successfully loaded ${contacts.length} contacts.`, 'success');

        document.querySelectorAll('.edit-cs-contact-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                const card = event.target.closest('[data-contact-id]');
                const contactId = card.dataset.contactId;
                const contactNumber = card.dataset.contactNumber;
                const contactDescription = card.dataset.contactDescription;
                const contactActive = card.dataset.contactActive === 'true'; // Convert back to boolean
                openCsContactModal(contactId, contactNumber, contactDescription, contactActive);
            });
        });

        document.querySelectorAll('.delete-cs-contact-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                const contactId = event.target.closest('[data-contact-id]').dataset.contactId;
                if (confirm('Are you sure you want to delete this contact?')) {
                    deleteCsContact(contactId);
                }
            });
        });

        document.querySelectorAll('.cs-active-toggle').forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                const contactId = event.target.closest('[data-contact-id]').dataset.contactId;
                const isActive = event.target.checked;
                toggleCsContactActiveStatus(contactId, isActive);
            });
        });


    } catch (error) {
        console.error('Admin Panel: Error fetching CS contacts:', error);
        showMessage(`Failed to load contacts: ${error.message || 'An unknown error occurred.'}`, 'error');
        csListBody.innerHTML = '<p class="text-center py-4 text-red-500">Error loading contacts.</p>';
    }
}

/**
 * Opens the modal to add or edit a customer service contact.
 * @param {string | null} contactId ID of contact to edit, or null for new.
 * @param {string} [number='']
 * @param {string} [description='']
 * @param {boolean} [isActive=false]
 */
function openCsContactModal(contactId = null, number = '', description = '', isActive = false) {
    csContactToManageId = contactId;
    csModalTitle.textContent = contactId ? 'Edit Contact' : 'Add New Contact';
    csModalNumber.value = number;
    csModalDescription.value = description;
    csModalActive.checked = isActive;
    csContactModal.classList.remove('hidden');
}

/**
 * Closes the customer service contact modal.
 */
function closeCsContactModal() {
    csContactModal.classList.add('hidden');
    csContactToManageId = null;
    hideMessage();
    csModalNumber.value = '';
    csModalDescription.value = '';
    csModalActive.checked = false;
}

/**
 * Handles saving (add/edit) of customer service contact changes.
 */
async function saveCsContactChanges() {
    hideMessage();
    const number = csModalNumber.value.trim();
    const description = csModalDescription.value.trim();
    const isActive = csModalActive.checked;

    if (!number || !description) {
        showMessage('Number and Description are required.', 'warning');
        return;
    }

    showMessage('Saving contact...', 'info');
    csModalSaveBtn.disabled = true;

    try {
        const idToken = await currentFirebaseUser.getIdToken();
        let url = `${BACKEND_API_BASE_URL}/admin/customer-service-contacts`;
        let method = 'POST';

        const payload = { number, description, is_active: isActive };

        if (csContactToManageId) { // If editing existing contact
            url += `/${csContactToManageId}`;
            method = 'PUT';
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await parseResponse(response);
            throw new Error(errorData.error || errorData.message || response.statusText);
        }

        const result = await response.json();
        showMessage(result.message, 'success');
        closeCsContactModal();
        fetchAndDisplayCsContacts(); // Refresh list

    } catch (error) {
        console.error('Admin Panel: Failed to save CS contact:', error);
        showMessage(`Failed to save contact: ${error.message || 'An unknown error occurred.'}`, 'error');
    } finally {
        csModalSaveBtn.disabled = false;
    }
}

/**
 * Handles deleting a customer service contact.
 * @param {string} contactId
 */
async function deleteCsContact(contactId) {
    hideMessage();
    showMessage('Deleting contact...', 'info');

    try {
        const idToken = await currentFirebaseUser.getIdToken();
        const response = await fetch(`${BACKEND_API_BASE_URL}/admin/customer-service-contacts/${contactId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!response.ok) {
            const errorData = await parseResponse(response);
            throw new Error(errorData.error || errorData.message || response.statusText);
        }

        showMessage('Contact deleted successfully!', 'success');
        fetchAndDisplayCsContacts(); // Refresh list

    } catch (error) {
        console.error('Admin Panel: Failed to delete CS contact:', error);
        showMessage(`Failed to delete contact: ${error.message || 'An unknown error occurred.'}`, 'error');
    }
}

/**
 * Toggles the active status of a customer service contact.
 * @param {string} contactId
 * @param {boolean} isActive
 */
async function toggleCsContactActiveStatus(contactId, isActive) {
    hideMessage();
    showMessage('Updating active status...', 'info');
    try {
        const idToken = await currentFirebaseUser.getIdToken();
        const response = await fetch(`${BACKEND_API_BASE_URL}/admin/customer-service-contacts/${contactId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ is_active: isActive })
        });

        if (!response.ok) {
            const errorData = await parseResponse(response);
            throw new Error(errorData.error || errorData.message || response.statusText);
        }
        showMessage('Contact active status updated!', 'success');
    } catch (error) {
        console.error('Admin Panel: Failed to toggle active status:', error);
        showMessage(`Failed to update status: ${error.message || 'An unknown error occurred.'}`, 'error');
        fetchAndDisplayCsContacts(); // Re-fetch to revert checkbox state if update failed on backend
    }
}



// --- Event Listeners ---
uploadBatchBtn.addEventListener('click', handleBatchUpload);
logoutBtn.addEventListener('click', handleLogout);

// User Management Listeners
viewUsersBtn.addEventListener('click', () => {
    if (userListContainer.classList.contains('hidden')) {
        userListContainer.classList.remove('hidden');
        viewUsersBtn.textContent = 'Hide All Users';
        fetchAndDisplayUsers();
    } else {
        userListContainer.classList.add('hidden');
        userListBody.innerHTML = '';
        viewUsersBtn.textContent = 'View All Users';
    }
});


// Customer Service Management Listeners
viewCsContactsBtn.addEventListener('click', () => {
    if (csTableWrapper.classList.contains('hidden')) {
        csTableWrapper.classList.remove('hidden');
        fetchAndDisplayCsContacts();
        viewCsContactsBtn.textContent = 'Hide All Contacts';
    } else {
        csTableWrapper.classList.add('hidden');
        viewCsContactsBtn.textContent = 'View All Contacts';
        csListBody.innerHTML = '<p class="text-center py-4 text-gray-500">Click "View All Contacts" to load.</p>';
    }
});
addCsContactBtn.addEventListener('click', () => openCsContactModal());


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // --- Get references for static elements ---
    csListBody = document.getElementById('cs-list-body');

    // --- Create and Append Modals to Body ---
    // User Management Modal
    userModal = document.createElement('div'); // Assign to global variable
    userModal.id = 'user-management-modal';
    userModal.classList.add('fixed', 'inset-0', 'bg-gray-900', 'bg-opacity-50', 'flex', 'justify-center', 'items-center', 'z-50', 'hidden');
    userModal.innerHTML = `
        <div class="modal-content">
            <button class="close-modal-btn" id="close-user-modal-top-btn">&times;</button>
            <h3 class="text-xl font-bold text-gray-800 mb-4">Manage User</h3>
            <p class="text-sm text-gray-600 mb-4">User ID: <span id="modal-user-id" class="font-mono text-xs bg-gray-100 px-2 py-1 rounded"></span></p>

            <div class="mb-4">
                <label for="modal-tier-select" class="block text-gray-700 text-sm font-bold mb-2">Change Tier:</label>
                <select id="modal-tier-select" class="shadow-sm border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                    <option value="tier1">Tier 1</option>
                    <option value="tier2">Tier 2</option>
                    <option value="tier3">Tier 3</option>
                </select>
            </div>

            <div class="mb-6">
                <label for="modal-role-select" class="block text-gray-700 text-sm font-bold mb-2">Change Role:</label>
                <select id="modal-role-select" class="shadow-sm border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                    <option value="">-- No Role --</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                </select>
            </div>

            <div class="flex justify-end space-x-3">
                <button id="modal-cancel-btn" class="app-button-gray w-auto py-2 px-4 text-sm">
                    Cancel
                </button>
                <button id="modal-save-btn" class="app-button-blue w-auto py-2 px-4 text-sm">
                    Save Changes
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(userModal);

    // Customer Service Contact Modal
    csContactModal = document.createElement('div'); // Assign to global variable
    csContactModal.id = 'cs-contact-modal';
    csContactModal.classList.add('fixed', 'inset-0', 'bg-gray-900', 'bg-opacity-50', 'flex', 'justify-center', 'items-center', 'z-50', 'hidden');
    csContactModal.innerHTML = `
        <div class="modal-content">
            <button class="close-modal-btn" id="close-cs-modal-top-btn">&times;</button>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 text-blue-500 mx-auto mb-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <h3 id="cs-modal-title" class="text-xl font-bold text-gray-800 mb-4">Add New Contact</h3>
            <div class="mb-4">
                <label for="cs-modal-number" class="block text-gray-700 text-sm font-bold mb-2">WhatsApp Number:</label>
                <input type="text" id="cs-modal-number" class="shadow-sm border rounded-lg w-full py-2.5 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="+12345678901">
            </div>
            <div class="mb-4">
                <label for="cs-modal-description" class="block text-gray-700 text-sm font-bold mb-2">Description:</label>
                <input type="text" id="cs-modal-description" class="shadow-sm border rounded-lg w-full py-2.5 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="e.g., General Support">
            </div>
            <div class="mb-6 flex items-center">
                <input type="checkbox" id="cs-modal-active" class="form-checkbox h-5 w-5 text-blue-600 rounded-md">
                <label for="cs-modal-active" class="ml-2 text-gray-700 text-sm font-bold">Is Active</label>
            </div>
            <div class="flex justify-end space-x-3">
                <button id="cs-modal-cancel-btn" class="app-button-gray w-auto py-2 px-4 text-sm">
                    Cancel
                </button>
                <button id="cs-modal-save-btn" class="app-button-blue w-auto py-2 px-4 text-sm">
                    Save Contact
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(csContactModal);


    // --- Get references for ALL dynamically created elements AFTER they are appended ---
    // User Management Modal elements
    modalUserIdSpan = userModal.querySelector('#modal-user-id');
    modalTierSelect = userModal.querySelector('#modal-tier-select');
    modalRoleSelect = userModal.querySelector('#modal-role-select');
    modalCancelBtn = userModal.querySelector('#modal-cancel-btn');
    modalSaveBtn = userModal.querySelector('#modal-save-btn');

    // Customer Service Contact Modal elements
    csModalTitle = csContactModal.querySelector('#cs-modal-title');
    csModalNumber = csContactModal.querySelector('#cs-modal-number');
    csModalDescription = csContactModal.querySelector('#cs-modal-description');
    csModalActive = csContactModal.querySelector('#cs-modal-active');
    csModalCancelBtn = csContactModal.querySelector('#cs-modal-cancel-btn');
    csModalSaveBtn = csContactModal.querySelector('#cs-modal-save-btn');
    const closeCsModalTopBtn = csContactModal.querySelector('#close-cs-modal-top-btn');


    // Initialize User Management UI elements and their listeners
    // These were correctly declared with 'let' at global scope, so no need to re-declare
    userListContainer = document.createElement('div'); // FIX: Re-initialize here for clarity in DOMContentLoaded scope
    userListContainer.id = 'user-list-container';
    userListContainer.classList.add('mt-6', 'p-4', 'bg-white', 'rounded-lg', 'shadow-sm', 'border', 'border-gray-200', 'hidden');

    userListBody = document.createElement('div'); // This is the new container for cards
    userListBody.id = 'user-list-body';
    userListBody.classList.add('space-y-3'); // Add spacing between cards

    userPaginationDiv = document.createElement('div'); // FIX: Re-initialize here
    userPaginationDiv.classList.add('flex', 'justify-between', 'mt-4');
    prevUsersBtn = document.createElement('button');
    prevUsersBtn.textContent = 'Previous';
    prevUsersBtn.classList.add('app-button-gray', 'w-auto', 'py-2', 'px-4', 'rounded-lg', 'text-sm');

    nextUsersBtn = document.createElement('button');
    nextUsersBtn.textContent = 'Next';
    nextUsersBtn.classList.add('app-button-blue', 'w-auto', 'py-2', 'px-4', 'rounded-lg', 'text-sm');

    // Attach event listeners for dynamically created pagination buttons
    nextUsersBtn.addEventListener('click', () => {
        if (hasMoreUsers && lastFetchedUserId) {
            fetchAndDisplayUsers(lastFetchedUserId);
        }
    });
    prevUsersBtn.addEventListener('click', () => {
        showMessage('Previous button clicked (MVP: returns to first page).', 'info');
        fetchAndDisplayUsers();
    });

    // Attach listeners for User Management Modal buttons
    modalCancelBtn.addEventListener('click', closeManageUserModal);
    modalSaveBtn.addEventListener('click', saveUserChanges);

    // Attach listeners for CS Contact Modal buttons
    csModalCancelBtn.addEventListener('click', closeCsContactModal);
    csModalSaveBtn.addEventListener('click', saveCsContactChanges);
    closeCsModalTopBtn.addEventListener('click', closeCsContactModal);

    // Append user list container and pagination buttons to the DOM
    const userManagementSection = document.getElementById('view-users-btn').parentElement;
    if (userManagementSection) {
        userManagementSection.appendChild(userListContainer);

        const userListHeader = document.createElement('h3');
        userListHeader.classList.add('text-lg', 'font-semibold', 'text-gray-800', 'mb-3');
        userListHeader.textContent = 'All Users';
        userListContainer.appendChild(userListHeader);

        userListContainer.appendChild(userListBody);
        userListBody.innerHTML = '<p class="text-center py-4 text-gray-500">Click "View All Users" to load.</p>';
        userPaginationDiv.appendChild(prevUsersBtn);
        userPaginationDiv.appendChild(nextUsersBtn);
        userListContainer.appendChild(userPaginationDiv);
    }


    // Initial check for screen size to determine if app or desktop message should be shown
    if (window.innerWidth > 767) {
        desktopMessage.classList.remove('hidden');
        initialLoaderOverlay.classList.add('hidden');
        appContainer.classList.add('hidden');
        console.log('Admin Panel: Detected desktop view. Showing desktop message.');
        return;
    } else {
        initialLoaderOverlay.classList.remove('hidden');
        appContainer.classList.add('opacity-0', 'pointer-events-none');
        console.log('Admin Panel: Detected mobile view. Showing initial loader.');
    }

    // Listen for Firebase Auth state changes
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentFirebaseUser = user;
            console.log('Admin Panel: Firebase user authenticated:', user.uid);
            currentUserRole = await getUserRole(user.uid);
            if (currentUserRole === 'super_admin' || currentUserRole === 'admin') {
                console.log(`Admin Panel: User is authorized as ${currentUserRole.toUpperCase()}.`);
                hideInitialLoaderAndShowContent();
            } else {
                console.warn('Admin Panel: User is NOT authorized as admin. Redirecting to main app.');
                showMessage('Access Denied: You are not authorized to view this page.', 'error');
                hideInitialLoaderAndShowContent(true);
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2000);
            }
        } else {
            console.warn('Admin Panel: No Firebase user authenticated. Redirecting to login.');
            showMessage('Session expired or not logged in. Redirecting to login.', 'warning');
            hideInitialLoaderAndShowContent(true);
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 1500);
        }
    });
    console.log('Admin Panel: DOMContentLoaded - Waiting for Firebase Auth state.');
});
