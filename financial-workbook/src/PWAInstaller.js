import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

const PWAInstaller = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Save the event so it can be triggered later
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    console.log(`User response to the install prompt: ${outcome}`);
    
    // Clear the deferredPrompt for next time
    setDeferredPrompt(null);
    setShowInstallPrompt(false);
  };

  const handleDismiss = () => {
    setShowInstallPrompt(false);
  };

  if (!showInstallPrompt) return null;

  return (
    <div className="pwa-install-prompt">
      <div className="pwa-install-content">
        <div className="pwa-install-info">
          <Download className="pwa-install-icon" />
          <div>
            <h4>Install Financial Workbook</h4>
            <p>Install this app for quick access and offline use!</p>
          </div>
        </div>
        <div className="pwa-install-actions">
          <button onClick={handleInstallClick} className="pwa-install-button">
            Install
          </button>
          <button onClick={handleDismiss} className="pwa-dismiss-button">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PWAInstaller;