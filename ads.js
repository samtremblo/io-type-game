// Ad management system
export class AdManager {
    constructor() {
        this.adSlots = {};
        this.initialized = false;
    }

    init() {
        // Initialize Google AdSense
        (adsbygoogle = window.adsbygoogle || []).push({});
        this.initialized = true;
    }

    createAdSlot(containerId, format = 'auto') {
        const adContainer = document.createElement('div');
        adContainer.className = 'adsbygoogle';
        adContainer.style.display = 'block';
        adContainer.setAttribute('data-ad-client', 'YOUR-AD-CLIENT-ID'); // Replace with your AdSense ID
        adContainer.setAttribute('data-ad-slot', 'YOUR-AD-SLOT-ID'); // Replace with your Ad slot ID
        adContainer.setAttribute('data-ad-format', format);
        adContainer.setAttribute('data-full-width-responsive', 'true');
        
        document.getElementById(containerId).appendChild(adContainer);
        this.adSlots[containerId] = adContainer;
        
        if (this.initialized) {
            (adsbygoogle = window.adsbygoogle || []).push({});
        }
    }

    showAd(containerId) {
        if (this.adSlots[containerId]) {
            this.adSlots[containerId].style.display = 'block';
        }
    }

    hideAd(containerId) {
        if (this.adSlots[containerId]) {
            this.adSlots[containerId].style.display = 'none';
        }
    }
}
