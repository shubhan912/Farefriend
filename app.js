// Modified calculateRouteInfo function to fetch real-time traffic data
async function calculateRouteInfo(pickup, dropoff) {
    try {
        // First, geocode the addresses to get coordinates
        const pickupCoords = await geocodeAddress(pickup);
        const dropoffCoords = await geocodeAddress(dropoff);
        
        if (!pickupCoords || !dropoffCoords) {
            throw new Error('Could not geocode one or both addresses');
        }
        
        // Get current traffic conditions using TomTom API (you need to register for an API key)
        // Note: Replace YOUR_TOMTOM_API_KEY with your actual API key
        const tomtomKey = 'YOUR_TOMTOM_API_KEY';
        const trafficUrl = `https://api.tomtom.com/routing/1/calculateRoute/${pickupCoords.lat},${pickupCoords.lon}:${dropoffCoords.lat},${dropoffCoords.lon}/json?key=${tomtomKey}&traffic=true`;
        
        // If you can't use TomTom, we'll use OSRM but estimate traffic based on time of day
        let useTrafficEstimate = true;
        let trafficData = null;
        
        try {
            if (tomtomKey !== 'YOUR_TOMTOM_API_KEY') {
                const trafficResponse = await fetch(trafficUrl);
                trafficData = await trafficResponse.json();
                useTrafficEstimate = false;
            }
        } catch (error) {
            console.log('Could not fetch real-time traffic data, using estimates', error);
            useTrafficEstimate = true;
        }
        
        // Use OSRM for the route if no traffic data
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pickupCoords.lon},${pickupCoords.lat};${dropoffCoords.lon},${dropoffCoords.lat}?overview=full&alternatives=true&steps=true`;
        
        const response = await fetch(osrmUrl);
        const data = await response.json();
        
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            throw new Error('No route found');
        }
        
        // Get base distance in km and duration in minutes from OSRM
        const distanceKm = (data.routes[0].distance / 1000).toFixed(1);
        const baseDurationMin = Math.ceil(data.routes[0].duration / 60);
        
        // Get route geometry for displaying and analyzing
        const routeGeometry = data.routes[0].geometry;
        
        // Calculate traffic-affected duration
        let trafficDurationMin = baseDurationMin;
        let trafficCondition = 'normal';
        let trafficDelayMin = 0;
        
        if (!useTrafficEstimate && trafficData && trafficData.routes && trafficData.routes.length > 0) {
            // Use actual traffic data from TomTom
            trafficDurationMin = Math.ceil(trafficData.routes[0].summary.travelTimeInSeconds / 60);
            trafficDelayMin = Math.max(0, trafficDurationMin - baseDurationMin);
            
            // Determine traffic condition based on delay
            if (trafficDelayMin > baseDurationMin * 0.5) {
                trafficCondition = 'heavy';
            } else if (trafficDelayMin > baseDurationMin * 0.2) {
                trafficCondition = 'moderate';
            }
        } else {
            // Estimate traffic based on time of day
            const hour = new Date().getHours();
            let trafficMultiplier = 1.0;
            
            // Rush hour traffic estimates
            if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 19)) {
                // Rush hours: 8-10 AM and 5-7 PM
                trafficMultiplier = 1.5;
                trafficCondition = 'moderate';
                
                // Even higher for certain peak times
                if (hour === 9 || hour === 18) {
                    trafficMultiplier = 1.8;
                    trafficCondition = 'heavy';
                }
            } else if ((hour >= 11 && hour <= 16) || (hour >= 20 && hour <= 22)) {
                // Medium traffic hours
                trafficMultiplier = 1.2;
                trafficCondition = 'light';
            }
            
            // Weekend adjustment (use day of week)
            const day = new Date().getDay();
            if (day === 0 || day === 6) { // Weekend (0 = Sunday, 6 = Saturday)
                trafficMultiplier *= 0.8; // Less traffic on weekends except for shopping areas
                
                // Weekend evening traffic in commercial/entertainment areas might still be heavy
                if (hour >= 18 && hour <= 21) {
                    trafficMultiplier = 1.3;
                    trafficCondition = 'moderate';
                }
            }
            
            // Calculate estimated traffic duration
            trafficDurationMin = Math.ceil(baseDurationMin * trafficMultiplier);
            trafficDelayMin = trafficDurationMin - baseDurationMin;
        }
        
        // Calculate average speed with traffic (km/h)
        const avgSpeedWithTraffic = (parseFloat(distanceKm) / (trafficDurationMin / 60)).toFixed(1);
        
        // Identify congestion points along the route for more accurate waiting time charges
        // This would be more precise with actual traffic API data
        const congestionPoints = [];
        
        // With real traffic data, we could identify specific road segments with slow traffic
        // For now, we'll use a simplified model based on the traffic condition
        let waitingTimeEstimate = 0;
        
        if (trafficCondition === 'heavy') {
            waitingTimeEstimate = Math.ceil(trafficDelayMin * 0.8); // 80% of delay time is waiting
            congestionPoints.push({
                description: 'Heavy traffic along route',
                estimatedWaitingMinutes: waitingTimeEstimate
            });
        } else if (trafficCondition === 'moderate') {
            waitingTimeEstimate = Math.ceil(trafficDelayMin * 0.5); // 50% of delay time is waiting
            congestionPoints.push({
                description: 'Moderate traffic delays',
                estimatedWaitingMinutes: waitingTimeEstimate
            });
        } else if (trafficDelayMin > 0) {
            waitingTimeEstimate = Math.ceil(trafficDelayMin * 0.3); // 30% of delay time is waiting
            congestionPoints.push({
                description: 'Light traffic in some areas',
                estimatedWaitingMinutes: waitingTimeEstimate
            });
        }
        
        // Render the route map
        renderRouteMap(pickupCoords, dropoffCoords, trafficCondition);
        
        return {
            distance: parseFloat(distanceKm),
            baseDuration: baseDurationMin,
            trafficDuration: trafficDurationMin,
            trafficDelay: trafficDelayMin,
            avgSpeed: avgSpeedWithTraffic,
            trafficCondition: trafficCondition,
            waitingTimeEstimate: waitingTimeEstimate,
            congestionPoints: congestionPoints,
            coordinates: {
                pickup: pickupCoords,
                dropoff: dropoffCoords
            },
            routeGeometry: routeGeometry
        };
    } catch (error) {
        console.error('Error calculating route:', error);
        alert('Could not calculate route. Please check the addresses and try again.');
        return null;
    }
}

// Enhanced renderRouteMap function to show traffic conditions
function renderRouteMap(pickupCoords, dropoffCoords, trafficCondition) {
    // Create a simple SVG map with a line between points colored by traffic condition
    let routeColor = "#1A73E8"; // Default blue for normal traffic
    
    if (trafficCondition === 'moderate') {
        routeColor = "#FFA500"; // Orange for moderate traffic
    } else if (trafficCondition === 'heavy') {
        routeColor = "#FF0000"; // Red for heavy traffic
    }
    
    const svg = `
    <svg width="100%" height="100%" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#e6e6e6" />
        <circle cx="30" cy="50" r="8" fill="#F7B801" />
        <circle cx="170" cy="50" r="8" fill="#00A64A" />
        <line x1="30" y1="50" x2="170" y2="50" stroke="${routeColor}" stroke-width="4" stroke-linecap="round" stroke-dasharray="10,5" />
        <text x="30" y="75" font-size="14" text-anchor="middle" fill="#000">A</text>
        <text x="170" y="75" font-size="14" text-anchor="middle" fill="#000">B</text>
        ${trafficCondition !== 'normal' ? `<text x="100" y="30" font-size="12" text-anchor="middle" fill="#333">${trafficCondition.charAt(0).toUpperCase() + trafficCondition.slice(1)} Traffic</text>` : ''}
    </svg>
    `;
    
    mapThumbnail.innerHTML = svg;
}

// Updated compute fare components to use traffic data
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
    
    // Waiting charge based on traffic data
    let waitingChargeAmount = 0;
    let waitingTimeMinutes = 0;
    
    // Use the waiting time estimate from our traffic data
    waitingTimeMinutes = routeInfo.waitingTimeEstimate;
    
    // If no explicit waiting time but very slow average speed, add waiting time
    if (waitingTimeMinutes === 0 && routeInfo.avgSpeed < FARE_CONSTANTS.TRAFFIC_SLOW_THRESHOLD) {
        // Estimate additional waiting time based on slow speeds
        waitingTimeMinutes = Math.round(routeInfo.trafficDuration * 0.2); // 20% of total time as waiting when speed is slow
    }
    
    // Calculate waiting charge
    waitingChargeAmount = Math.ceil(waitingTimeMinutes * FARE_CONSTANTS.WAITING_CHARGE_PER_MIN);
    
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
    
    // Decrease confidence if using estimated traffic rather than real-time data
    if (routeInfo.trafficCondition !== 'normal' && !routeInfo.hasOwnProperty('realTimeData')) {
        confidenceScore -= 8;
    }
    
    // Return the fare details with enhanced traffic information
    return {
        baseFare: baseFareAmount,
        distanceFare: distanceFareAmount,
        chargeableDistance: chargeableDistance.toFixed(1),
        nightCharge: nightChargeAmount,
        isNightTime: isNightTime,
        waitingCharge: waitingChargeAmount,
        waitingTimeMinutes: waitingTimeMinutes,
        trafficCondition: routeInfo.trafficCondition,
        trafficDelay: routeInfo.trafficDelay,
        totalFare: totalFareAmount,
        confidenceScore: confidenceScore
    };
}

// Update the fare display in the UI with traffic information
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
        
        // Add traffic information to waiting charge row
        const waitingLabel = document.querySelector('[for="waiting-fare"]');
        waitingLabel.innerHTML = `Waiting Charge <small>(${fareDetails.waitingTimeMinutes} min, ${fareDetails.trafficCondition} traffic)</small>`;
    } else {
        waitingChargeRow.style.display = 'none';
    }
    
    // Update total fare
    totalFare.textContent = fareDetails.totalFare;
    autoFareCompare.textContent = fareDetails.totalFare;
    
    // Update confidence score
    confidenceValue.textContent = fareDetails.confidenceScore + '%';
    
    // Add traffic condition indicator
    const fareBreakdownTitle = document.querySelector('.fare-breakdown h3');
    if (fareBreakdownTitle) {
        let trafficIcon = '';
        let trafficText = '';
        
        switch(fareDetails.trafficCondition) {
            case 'heavy':
                trafficIcon = '🔴';
                trafficText = 'Heavy Traffic';
                break;
            case 'moderate':
                trafficIcon = '🟠';
                trafficText = 'Moderate Traffic';
                break;
            case 'light':
                trafficIcon = '🟡';
                trafficText = 'Light Traffic';
                break;
            default:
                trafficIcon = '🟢';
                trafficText = 'Normal Traffic';
        }
        
        fareBreakdownTitle.innerHTML = `Fare Breakdown <span class="traffic-indicator">${trafficIcon} ${trafficText}</span>`;
    }
    
    // Update time value to show both normal and traffic-affected duration
    if (fareDetails.trafficDelay > 0) {
        const originalTimeValue = document.getElementById('time-value');
        const normalDuration = parseInt(originalTimeValue.textContent) - fareDetails.trafficDelay;
        timeValue.innerHTML = `${originalTimeValue.textContent} <small>(+${fareDetails.trafficDelay} min due to traffic)</small>`;
    }
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
    
    // Get route info with traffic data
    calculateRouteInfo(pickup, dropoff).then(routeInfo => {
        if (!routeInfo) {
            calculateFareBtn.innerHTML = '<i class="fas fa-rupee-sign"></i> Calculate Fare';
            calculateFareBtn.disabled = false;
            return;
        }
        
        // Set the basic route info in the UI
        distanceValue.textContent = routeInfo.distance;
        timeValue.textContent = routeInfo.trafficDuration; // Using traffic-affected duration
        
        // Calculate fare components
        const fareDetails = computeFareComponents(routeInfo);
        
        // Update the UI with fare details
        updateFareDisplay(fareDetails);
        
        // Compare with Ola/Uber estimates
        const compareEstimates = estimateRideHailingFares(routeInfo);
        olaFare.textContent = compareEstimates.ola;
        uberFare.textContent = compareEstimates.uber;
        
        // Display traffic-specific message if applicable
        if (routeInfo.trafficCondition !== 'normal') {
            const trafficMessage = document.createElement('div');
            trafficMessage.className = 'traffic-alert';
            
            let messageText = '';
            switch(routeInfo.trafficCondition) {
                case 'heavy':
                    messageText = `Heavy traffic detected! Your ride may take ${routeInfo.trafficDelay} minutes longer than usual.`;
                    break;
                case 'moderate':
                    messageText = `Moderate traffic detected. Expect a ${routeInfo.trafficDelay}-minute delay.`;
                    break;
                default:
                    messageText = `Light traffic detected. Your ride might be slightly delayed.`;
            }
            
            trafficMessage.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${messageText}`;
            
            // Insert after the fare result section
            fareResultSection.appendChild(trafficMessage);
        }
        
        // Display result section
        fareResultSection.style.display = 'block';
        
        // Reset button
        calculateFareBtn.innerHTML = '<i class="fas fa-rupee-sign"></i> Calculate Fare';
        calculateFareBtn.disabled = false;
        
        // Scroll to results
        fareResultSection.scrollIntoView({ behavior: 'smooth' });
    });
}

// Modified ride-hailing service fare estimation to account for traffic
function estimateRideHailingFares(routeInfo) {
    // Simple estimates based on distance, time and traffic conditions
    // In a real app, these would come from API calls to the services
    
    // Traffic surge multipliers
    let surgeFactor = 1.0;
    if (routeInfo.trafficCondition === 'heavy') {
        surgeFactor = 1.4; // 40% surge during heavy traffic
    } else if (routeInfo.trafficCondition === 'moderate') {
        surgeFactor = 1.2; // 20% surge during moderate traffic
    }
    
    // Time-based surge (peak hours)
    const hour = new Date().getHours();
    if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20)) {
        surgeFactor += 0.1; // Additional 10% during peak hours
    }
    
    // Estimate Ola Mini fare
    const olaBaseFare = 45;
    const olaPerKm = 12;
    const olaPerMin = 1;
    const olaEstimate = Math.ceil((olaBaseFare + 
                                  (routeInfo.distance * olaPerKm) + 
                                  (routeInfo.trafficDuration * olaPerMin)) * 
                                 surgeFactor);
    
    // Estimate Uber Go fare
    const uberBaseFare = 48;
    const uberPerKm = 14;
    const uberPerMin = 1.2;
    const uberEstimate = Math.ceil((uberBaseFare + 
                                   (routeInfo.distance * uberPerKm) + 
                                   (routeInfo.trafficDuration * uberPerMin)) * 
                                  surgeFactor);
    
    return {
        ola: olaEstimate,
        uber: uberEstimate
    };
}