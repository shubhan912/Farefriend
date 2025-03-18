// Constants for fare calculation
const FARE_CONSTANTS = {
    BASE_FARE: 26, // New base fare in Mumbai (₹)
    PER_KM_RATE: 16, // Rate per km after first 1.5km (₹)
    MIN_DISTANCE: 1.5, // Minimum distance covered in base fare (km)
    NIGHT_CHARGE_MULTIPLIER: 1.25, // 25% extra for night rides
    NIGHT_START_HOUR: 22, // 10 PM
    NIGHT_END_HOUR: 5, // 5 AM
    WAITING_CHARGE_PER_MIN: 1.5, // ₹1.5 per minute of waiting
    TRAFFIC_SLOW_THRESHOLD: 15, // km/h - below this is considered slow traffic
};

// Cache for user's saved trips and preferences
let userCache = {
    history: JSON.parse(localStorage.getItem('tripHistory')) || [],
    savedLocations: JSON.parse(localStorage.getItem('savedLocations')) || [],
    lastUsedLocations: JSON.parse(localStorage.getItem('lastUsedLocations')) || { pickup: "", dropoff: "" }
};

// DOM Elements
const pickupInput = document.getElementById('pickup-location');
const dropoffInput = document.getElementById('dropoff-location');
const currentLocationBtn = document.getElementById('current-location');
const journeyTimeSelect = document.getElementById('journey-time');
const scheduleTimeContainer = document.getElementById('schedule-time-container');
const scheduleTimeInput = document.getElementById('schedule-time');
const calculateFareBtn = document.getElementById('calculate-fare');
const fareResultSection = document.getElementById('fare-result');
const distanceValue = document.getElementById('distance-value');
const timeValue = document.getElementById('time-value');
const baseFare = document.getElementById('base-fare');
const distanceCharged = document.getElementById('distance-charged');
const distanceFare = document.getElementById('distance-fare');
const nightChargeRow = document.getElementById('night-charge-row');
const nightFare = document.getElementById('night-fare');
const waitingChargeRow = document.getElementById('waiting-charge-row');
const waitingFare = document.getElementById('waiting-fare');
const totalFare = document.getElementById('total-fare');
const autoFareCompare = document.getElementById('auto-fare-compare');
const olaFare = document.getElementById('ola-fare');
const uberFare = document.getElementById('uber-fare');
const confidenceValue = document.getElementById('confidence-value');
const mapThumbnail = document.getElementById('map-thumbnail');
const reportBtn = document.getElementById('report-btn');
const shareBtn = document.getElementById('share-btn');
const saveBtn = document.getElementById('save-btn');
const historyBtn = document.getElementById('history-btn');
const profileBtn = document.getElementById('profile-btn');
const reportModal = document.getElementById('report-modal');
const historyModal = document.getElementById('history-modal');
const closeModalBtns = document.querySelectorAll('.close-modal');
const submitReportBtn = document.getElementById('submit-report');
const actualFareInput = document.getElementById('actual-fare');
const fareIssuesSelect = document.getElementById('fare-issues');
const additionalCommentsInput = document.getElementById('additional-comments');
const historyList = document.getElementById('history-list');

// Initialize the app
function initApp() {
    // Pre-fill inputs with last used locations if available
    if (userCache.lastUsedLocations.pickup) {
        pickupInput.value = userCache.lastUsedLocations.pickup;
    }
    
    if (userCache.lastUsedLocations.dropoff) {
        dropoffInput.value = userCache.lastUsedLocations.dropoff;
    }
    
    // Load history if available
    renderTripHistory();
    
    // Set default schedule time to current time + 1 hour
    const now = new Date();
    now.setHours(now.getHours() + 1);
    scheduleTimeInput.value = now.toISOString().slice(0, 16);
    
    // Initialize map (if we're using Leaflet)
    initializeMap();
    
    // Set up event listeners
    setupEventListeners();
}

// Set up all event listeners for the app
function setupEventListeners() {
    // Journey time selection changes
    journeyTimeSelect.addEventListener('change', function() {
        if (this.value === 'schedule') {
            scheduleTimeContainer.style.display = 'block';
        } else {
            scheduleTimeContainer.style.display = 'none';
        }
    });
    
    // Current location button
    currentLocationBtn.addEventListener('click', getCurrentLocation);
    
    // Calculate fare button
    calculateFareBtn.addEventListener('click', calculateFare);
    
    // Modal close buttons
    closeModalBtns.forEach(btn => {
        btn.addEventListener('click', closeModals);
    });
    
    // Report fare button
    reportBtn.addEventListener('click', function() {
        reportModal.style.display = 'block';
    });
    
    // History button
    historyBtn.addEventListener('click', function() {
        renderTripHistory();
        historyModal.style.display = 'block';
    });
    
    // Submit report button
    submitReportBtn.addEventListener('click', submitFareReport);
    
    // Share button
    shareBtn.addEventListener('click', shareTrip);
    
    // Save button
    saveBtn.addEventListener('click', saveTrip);
    
    // Close modals when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === reportModal) {
            reportModal.style.display = 'none';
        }
        if (event.target === historyModal) {
            historyModal.style.display = 'none';
        }
    });
}

// Get current location using Geolocation API
function getCurrentLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }
    
    pickupInput.placeholder = 'Getting your location...';
    
    navigator.geolocation.getCurrentPosition(
        async function(position) {
            // Convert coordinates to address using reverse geocoding
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}`);
                const data = await response.json();
                
                // Format the address
                const address = data.display_name.split(',').slice(0, 3).join(', ');
                pickupInput.value = address;
            } catch (error) {
                pickupInput.value = `${position.coords.latitude}, ${position.coords.longitude}`;
                console.error('Error fetching address:', error);
            }
        },
        function(error) {
            pickupInput.placeholder = 'Enter pickup location...';
            alert(`Unable to retrieve your location: ${error.message}`);
        }
    );
}

// Initialize map for route visualization
function initializeMap() {
    // We'll use this when we need to show a route
    // For now we'll just prepare the container
    mapThumbnail.innerHTML = '<div style="width:100%;height:100%;display:flex;justify-content:center;align-items:center;background:#f0f0f0;color:#666;font-size:12px;">Route map will appear here</div>';
}

// Calculate route distance and time between two locations
async function calculateRouteInfo(pickup, dropoff) {
    try {
        // First, geocode the addresses to get coordinates
        const pickupCoords = await geocodeAddress(pickup);
        const dropoffCoords = await geocodeAddress(dropoff);
        
        if (!pickupCoords || !dropoffCoords) {
            throw new Error('Could not geocode one or both addresses');
        }
        
        // Use OSRM service to calculate route
        const url = `https://router.project-osrm.org/route/v1/driving/${pickupCoords.lon},${pickupCoords.lat};${dropoffCoords.lon},${dropoffCoords.lat}?overview=false`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            throw new Error('No route found');
        }
        
        // Get distance in km and duration in minutes
        const distanceKm = (data.routes[0].distance / 1000).toFixed(1);
        const durationMin = Math.ceil(data.routes[0].duration / 60);
        
        // Render a simple map with the route
        renderRouteMap(pickupCoords, dropoffCoords);
        
        return {
            distance: parseFloat(distanceKm),
            duration: durationMin,
            coordinates: {
                pickup: pickupCoords,
                dropoff: dropoffCoords
            }
        };
    } catch (error) {
        console.error('Error calculating route:', error);
        alert('Could not calculate route. Please check the addresses and try again.');
        return null;
    }
}

// Geocode an address to get coordinates
async function geocodeAddress(address) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error(`Address not found: ${address}`);
        }
        
        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon)
        };
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

// Render a static map with the route
function renderRouteMap(pickupCoords, dropoffCoords) {
    // For a simple static map, we can use a Static Map API
    // For demo purposes, we'll just show a placeholder or use Leaflet later
    
    // Create a simple SVG map with a line between points
    const svg = `
    <svg width="100%" height="100%" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#e6e6e6" />
        <circle cx="30" cy="50" r="8" fill="#F7B801" />
        <circle cx="170" cy="50" r="8" fill="#00A64A" />
        <line x1="30" y1="50" x2="170" y2="50" stroke="#1A73E8" stroke-width="4" stroke-linecap="round" stroke-dasharray="10,5" />
        <text x="30" y="75" font-size="14" text-anchor="middle" fill="#000">A</text>
        <text x="170" y="75" font-size="14" text-anchor="middle" fill="#000">B</text>
    </svg>
    `;
    
    mapThumbnail.innerHTML = svg;
}

// Calculate fare based on distance, time, and other factors
function calculateFare() {
    const pickup = pickupInput.value.trim();
    const dropoff = dropoffInput.value.trim();
    
    // Validate inputs
    if (!pickup || !dropoff) {
        alert('Please enter both pickup and dropoff locations');
        return;
    }
    
    // Save current locations to cache
    userCache.lastUsedLocations = { pickup, dropoff };
    localStorage.setItem('lastUsedLocations', JSON.stringify(userCache.lastUsedLocations));
    
    // Show loading state
    calculateFareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating...';
    calculateFareBtn.disabled = true;
    
    // Get route info (distance and time)
    calculateRouteInfo(pickup, dropoff).then(routeInfo => {
        if (!routeInfo) {
            calculateFareBtn.innerHTML = '<i class="fas fa-rupee-sign"></i> Calculate Fare';
            calculateFareBtn.disabled = false;
            return;
        }
        
        // Set the basic route info in the UI
        distanceValue.textContent = routeInfo.distance;
        timeValue.textContent = routeInfo.duration;
        
        // Calculate fare components
        const fareDetails = computeFareComponents(routeInfo);
        
        // Update the UI with fare details
        updateFareDisplay(fareDetails);
        
        // Compare with Ola/Uber estimates
        const compareEstimates = estimateRideHailingFares(routeInfo);
        olaFare.textContent = compareEstimates.ola;
        uberFare.textContent = compareEstimates.uber;
        
        // Display result section
        fareResultSection.style.display = 'block';
        
        // Reset button
        calculateFareBtn.innerHTML = '<i class="fas fa-rupee-sign"></i> Calculate Fare';
        calculateFareBtn.disabled = false;
        
        // Scroll to results
        fareResultSection.scrollIntoView({ behavior: 'smooth' });
    });
}

// Compute all fare components
function computeFareComponents(routeInfo) {
    // Get current date and time or scheduled time
    let fareTime;
    if (journeyTimeSelect.value === 'schedule') {
        fareTime = new Date(scheduleTimeInput.value);
    } else {
        fareTime = new Date();
    }
    
    const hour = fareTime.getHours();
    
    // Check if night charge applies
    const isNightTime = (hour >= FARE_CONSTANTS.NIGHT_START_HOUR || hour < FARE_CONSTANTS.NIGHT_END_HOUR);
    
    // Base fare calculation
    const baseFareAmount = FARE_CONSTANTS.BASE_FARE;
    
    // Distance fare calculation (after minimum distance)
    let chargeableDistance = 0;
    if (routeInfo.distance > FARE_CONSTANTS.MIN_DISTANCE) {
        chargeableDistance = routeInfo.distance - FARE_CONSTANTS.MIN_DISTANCE;
    }
    
    const distanceFareAmount = Math.ceil(chargeableDistance * FARE_CONSTANTS.PER_KM_RATE);
    
    // Waiting charge estimation based on route duration and average speed
    let waitingChargeAmount = 0;
    const avgSpeed = routeInfo.distance / (routeInfo.duration / 60); // km/h
    
    if (avgSpeed < FARE_CONSTANTS.TRAFFIC_SLOW_THRESHOLD) {
        // Estimate waiting time based on traffic conditions
        const trafficDelayMinutes = Math.round((routeInfo.duration * 0.3)); // 30% of total time as waiting
        waitingChargeAmount = Math.ceil(trafficDelayMinutes * FARE_CONSTANTS.WAITING_CHARGE_PER_MIN);
    }
    
    // Night charge calculation
    let nightChargeAmount = 0;
    if (isNightTime) {
        nightChargeAmount = Math.ceil((baseFareAmount + distanceFareAmount) * (FARE_CONSTANTS.NIGHT_CHARGE_MULTIPLIER - 1));
    }
    
    // Calculate total fare
    const totalFareAmount = baseFareAmount + distanceFareAmount + waitingChargeAmount + nightChargeAmount;
    
    // Calculate confidence score (more factors = less confidence)
    let confidenceScore = 95;
    if (isNightTime) confidenceScore -= 5;
    if (waitingChargeAmount > 0) confidenceScore -= 10;
    if (routeInfo.distance > 10) confidenceScore -= 5;
    // Return the fare details
    return {
        baseFare: baseFareAmount,
        distanceFare: distanceFareAmount,
        chargeableDistance: chargeableDistance.toFixed(1),
        nightCharge: nightChargeAmount,
        isNightTime: isNightTime,
        waitingCharge: waitingChargeAmount,
        totalFare: totalFareAmount,
        confidenceScore: confidenceScore
    };
}

// Update the fare display in the UI
function updateFareDisplay(fareDetails) {
    // Update base fare
    baseFare.textContent = fareDetails.baseFare;
    
    // Update distance fare
    distanceCharged.textContent = fareDetails.chargeableDistance;
    distanceFare.textContent = fareDetails.distanceFare;
    
    // Update night charge if applicable
    if (fareDetails.isNightTime && fareDetails.nightCharge > 0) {
        nightChargeRow.style.display = 'table-row';
        nightFare.textContent = fareDetails.nightCharge;
    } else {
        nightChargeRow.style.display = 'none';
    }
    
    // Update waiting charge if applicable
    if (fareDetails.waitingCharge > 0) {
        waitingChargeRow.style.display = 'table-row';
        waitingFare.textContent = fareDetails.waitingCharge;
    } else {
        waitingChargeRow.style.display = 'none';
    }
    
    // Update total fare
    totalFare.textContent = fareDetails.totalFare;
    autoFareCompare.textContent = fareDetails.totalFare;
    
    // Update confidence score
    confidenceValue.textContent = fareDetails.confidenceScore + '%';
}

// Estimate ride-hailing service fares for comparison
function estimateRideHailingFares(routeInfo) {
    // Simple estimates based on distance and base fares
    // In a real app, these would come from API calls to the services
    
    // Estimate Ola Mini fare
    const olaBaseFare = 45;
    const olaPerKm = 12;
    const olaEstimate = Math.ceil(olaBaseFare + (routeInfo.distance * olaPerKm));
    
    // Estimate Uber Go fare
    const uberBaseFare = 48;
    const uberPerKm = 14;
    const uberEstimate = Math.ceil(uberBaseFare + (routeInfo.distance * uberPerKm));
    
    return {
        ola: olaEstimate,
        uber: uberEstimate
    };
}

// Close all modals
function closeModals() {
    reportModal.style.display = 'none';
    historyModal.style.display = 'none';
}

// Submit a fare report from the user
function submitFareReport() {
    const actualFare = parseInt(actualFareInput.value);
    
    if (!actualFare || isNaN(actualFare)) {
        alert('Please enter a valid fare amount');
        return;
    }
    
    // Get selected issues
    const selectedIssues = Array.from(fareIssuesSelect.selectedOptions).map(option => option.value);
    
    // Get current trip data
    const currentTrip = {
        pickup: pickupInput.value,
        dropoff: dropoffInput.value,
        distance: parseFloat(distanceValue.textContent),
        estimatedFare: parseInt(totalFare.textContent),
        actualFare: actualFare,
        issues: selectedIssues,
        comments: additionalCommentsInput.value,
        reportedAt: new Date().toISOString(),
        // Calculate difference percentage
        difference: ((actualFare - parseInt(totalFare.textContent)) / parseInt(totalFare.textContent) * 100).toFixed(1)
    };
    
    // Add to our local collection
    saveReportToLocalDB(currentTrip);
    
    // In a real app, this would also be sent to a server
    
    // Reset form and close modal
    actualFareInput.value = '';
    fareIssuesSelect.selectedIndex = -1;
    additionalCommentsInput.value = '';
    reportModal.style.display = 'none';
    
    // Show thank you message
    alert('Thanks for reporting! Your data helps make fare estimation more accurate for everyone.');
}

// Save a fare report to local storage
function saveReportToLocalDB(tripData) {
    // Get existing reports
    let fareReports = JSON.parse(localStorage.getItem('fareReports')) || [];
    
    // Add new report
    fareReports.push(tripData);
    
    // Save back to storage
    localStorage.setItem('fareReports', JSON.stringify(fareReports));
}

// Share trip details
function shareTrip() {
    // In a real app, this would create a shareable link or use the Web Share API
    // For now, we'll simulate it
    
    const shareText = `I'm taking an auto from ${pickupInput.value} to ${dropoffInput.value}. The estimated fare is ₹${totalFare.textContent}. Powered by FareFriend!`;
    
    if (navigator.share) {
        navigator.share({
            title: 'My Auto Fare Estimate',
            text: shareText,
            url: window.location.href
        })
        .then(() => console.log('Shared successfully'))
        .catch((error) => console.log('Error sharing:', error));
    } else {
        // Fallback for browsers that don't support Web Share API
        alert(`Share this info:\n\n${shareText}`);
    }
}

// Save trip to history
function saveTrip() {
    // Create trip object
    const trip = {
        id: Date.now(),
        pickup: pickupInput.value,
        dropoff: dropoffInput.value,
        distance: parseFloat(distanceValue.textContent),
        duration: parseInt(timeValue.textContent),
        fare: parseInt(totalFare.textContent),
        date: new Date().toISOString()
    };
    
    // Add to history
    userCache.history.unshift(trip); // Add to beginning of array
    
    // Limit history to 20 items
    if (userCache.history.length > 20) {
        userCache.history = userCache.history.slice(0, 20);
    }
    
    // Save to localStorage
    localStorage.setItem('tripHistory', JSON.stringify(userCache.history));
    
    // Show confirmation
    alert('Trip saved to history!');
}

// Render trip history in modal
function renderTripHistory() {
    if (userCache.history.length === 0) {
        historyList.innerHTML = '<p>No trip history yet. Your saved trips will appear here.</p>';
        return;
    }
    
    let historyHTML = '';
    
    userCache.history.forEach(trip => {
        const tripDate = new Date(trip.date);
        const formattedDate = tripDate.toLocaleDateString() + ' ' + tripDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        historyHTML += `
        <div class="history-item">
            <div class="history-route-info">
                <h4>${trip.pickup} → ${trip.dropoff}</h4>
                <p>${trip.distance} km · ${formattedDate}</p>
            </div>
            <div class="history-fare">₹${trip.fare}</div>
        </div>
        `;
    });
    
    historyList.innerHTML = historyHTML;
}

// Create custom auto-rickshaw logo
function createRickshawLogo() {
    const logoImg = document.getElementById('logo-img');
    
    // Create a simple SVG logo
    logoImg.outerHTML = `
    <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="25" x="5" y="15" fill="#F7B801" rx="5" />
        <circle cx="15" cy="40" r="7" fill="#333" stroke="#666" stroke-width="2" />
        <circle cx="35" cy="40" r="7" fill="#333" stroke="#666" stroke-width="2" />
        <path d="M5 25 L5 15 Q5 5 15 5 L35 5 Q45 5 45 15 L45 25" fill="none" stroke="#00A64A" stroke-width="2" />
        <rect width="15" height="10" x="17.5" y="10" fill="#1A73E8" rx="2" />
    </svg>
    `;
}

// Initialize the application on page load
document.addEventListener('DOMContentLoaded', function() {
    initApp();
    createRickshawLogo();
});