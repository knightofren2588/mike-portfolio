import React, { useState, useEffect } from 'react';
import cloudStorage from './cloudStorage';

const FinanceHubPro = () => {
  // State for cloud sync status
  const [syncStatus, setSyncStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupFile, setBackupFile] = useState(null);
  const [importError, setImportError] = useState(null);
  const [manualUserId, setManualUserId] = useState('');
  const [showUserIdSection, setShowUserIdSection] = useState(false);

  // Load data from cloud storage
  const loadData = async () => {
    try {
      setIsLoading(true);
      const data = await cloudStorage.loadData();
      setSyncStatus(cloudStorage.getSyncStatus());
      return data;
    } catch (error) {
      console.error('Error loading data:', error);
      return cloudStorage.getDefaultData();
    } finally {
      setIsLoading(false);
    }
  };

  const [data, setData] = useState(null);
  const [activeView, setActiveView] = useState('overview');
  const [editingItem, setEditingItem] = useState(null);
  const [editType, setEditType] = useState(null);
  const [showNewMonthForm, setShowNewMonthForm] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(null);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAddSubscriptionModal, setShowAddSubscriptionModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [newAccount, setNewAccount] = useState({ name: '', type: 'checking', provider: '', last4: '' });
  const [newSubscription, setNewSubscription] = useState({ 
    name: '', 
    amount: '', 
    provider: '', 
    description: '', 
    billingCycle: 'monthly',
    category: 'Entertainment',
    nextBilling: ''
  });
  const [newUser, setNewUser] = useState({ name: '', email: '', company: '' });
  const [newMonth, setNewMonth] = useState({ name: '', year: new Date().getFullYear() });
  const [newBill, setNewBill] = useState({ name: '', amount: '', dueDate: '', category: 'Other', isSubscription: false });
  const [newPaycheck, setNewPaycheck] = useState({ date: '', amount: '', source: 'Equitas Health', label: '' });

  const currentMonth = data?.months?.[data?.currentMonthId];

  // Initialize data on component mount
  useEffect(() => {
    const initializeData = async () => {
      // Test Supabase connection first
      const connectionTest = await cloudStorage.testConnection();
      console.log('Supabase connection test:', connectionTest);
      
      const initialData = await loadData();
      setData(initialData);
    };
    initializeData();
  }, []);

  // Save data to cloud storage
  useEffect(() => {
    if (data) {
      const saveData = async () => {
        const result = await cloudStorage.saveData(data);
        if (result.success) {
          setSyncStatus(cloudStorage.getSyncStatus());
        }
      };
      saveData();
    }
  }, [data]);

  // Switch to different month
  const switchMonth = (monthId) => {
    setData(prev => ({ ...prev, currentMonthId: monthId }));
  };

  // Create new month
  const createNewMonth = () => {
    if (!newMonth.name) return;
    
    const monthId = `${newMonth.name.toLowerCase()}-${newMonth.year}`;
    const month = {
      id: monthId,
      name: newMonth.name,
      year: parseInt(newMonth.year),
      bills: [],
      paychecks: []
    };
    
    setData(prev => ({
      ...prev,
      months: { ...prev.months, [monthId]: month },
      currentMonthId: monthId
    }));
    
    setNewMonth({ name: '', year: new Date().getFullYear() });
    setShowNewMonthForm(false);
  };

  // Copy previous month's recurring bills
  const copyFromPreviousMonth = () => {
    if (!data?.months || !data?.currentMonthId) return;
    
    const monthIds = Object.keys(data.months);
    const currentIndex = monthIds.indexOf(data.currentMonthId);
    if (currentIndex > 0) {
      const previousMonth = data.months[monthIds[currentIndex - 1]];
      if (!previousMonth?.bills) return;
      
      const recurringBills = previousMonth.bills.map(bill => ({
        ...bill,
        id: Date.now() + Math.random(),
        isPaid: false,
        assignedPaycheck: null
      }));
      
      setData(prev => ({
        ...prev,
        months: {
          ...prev.months,
          [data.currentMonthId]: {
            ...currentMonth,
            bills: [...(currentMonth?.bills || []), ...recurringBills]
          }
        }
      }));
    }
  };

  // Add new bill
  const addBill = () => {
    if (!newBill.name || !newBill.amount || !data?.currentMonthId) return;
    
    const bill = {
      id: Date.now(),
      name: newBill.name,
      amount: parseFloat(newBill.amount),
      dueDate: parseInt(newBill.dueDate) || 1,
      category: newBill.category,
      assignedPaycheck: null,
      isPaid: false,
      isSubscription: newBill.isSubscription
    };
    
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          bills: [...(currentMonth?.bills || []), bill]
        }
      }
    }));
    
    setNewBill({ name: '', amount: '', dueDate: '', category: 'Other', isSubscription: false });
  };

  // Add new paycheck
  const addPaycheck = () => {
    if (!newPaycheck.date || !newPaycheck.amount || !data?.currentMonthId) return;
    
    const paycheck = {
      id: Date.now(),
      date: newPaycheck.date,
      amount: parseFloat(newPaycheck.amount),
      source: newPaycheck.source,
      label: newPaycheck.label || `Paycheck ${(currentMonth?.paychecks?.length || 0) + 1}`
    };
    
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          paychecks: [...(currentMonth?.paychecks || []), paycheck]
        }
      }
    }));
    
    setNewPaycheck({ date: '', amount: '', source: 'Equitas Health', label: '' });
  };

  // Update bill
  const updateBill = (billId, updates) => {
    if (!data?.currentMonthId || !currentMonth?.bills) return;
    
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          bills: currentMonth.bills.map(bill => 
            bill.id === billId ? { ...bill, ...updates } : bill
          )
        }
      }
    }));
  };

  // Update paycheck
  const updatePaycheck = (paycheckId, updates) => {
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          paychecks: currentMonth?.paychecks?.map(paycheck => 
            paycheck.id === paycheckId ? { ...paycheck, ...updates } : paycheck
          )
        }
      }
    }));
  };

  // Delete bill
  const deleteBill = (billId) => {
    if (!data?.currentMonthId || !currentMonth?.bills) return;
    
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          bills: currentMonth.bills.filter(bill => bill.id !== billId)
        }
      }
    }));
  };

  // Delete paycheck
  const deletePaycheck = (paycheckId) => {
    if (!data?.currentMonthId || !currentMonth?.paychecks || !currentMonth?.bills) return;
    
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          paychecks: currentMonth.paychecks.filter(paycheck => paycheck.id !== paycheckId),
          bills: currentMonth.bills.map(bill => 
            bill.assignedPaycheck === paycheckId 
              ? { ...bill, assignedPaycheck: null }
              : bill
          )
        }
      }
    }));
  };

  // Start editing
  const startEdit = (item, type) => {
    setEditingItem({ ...item });
    setEditType(type);
  };

  // Save edit
  const saveEdit = () => {
    if (editType === 'bill') {
      updateBill(editingItem.id, editingItem);
    } else if (editType === 'paycheck') {
      updatePaycheck(editingItem.id, editingItem);
    }
    setEditingItem(null);
    setEditType(null);
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingItem(null);
    setEditType(null);
  };

  // Assign bill to paycheck
  const assignBillToPaycheck = (billId, paycheckId) => {
    updateBill(billId, { assignedPaycheck: paycheckId });
  };

  // Get bills by paycheck
  const getBillsByPaycheck = (paycheckId) => {
    return currentMonth?.bills?.filter(bill => bill.assignedPaycheck === paycheckId) || [];
  };

  // Get unassigned bills
  const getUnassignedBills = () => {
    return currentMonth?.bills?.filter(bill => bill.assignedPaycheck === null) || [];
  };

  // Calculate totals
  const getPaycheckTotal = (paycheckId) => {
    return getBillsByPaycheck(paycheckId).reduce((sum, bill) => sum + bill.amount, 0);
  };

  const getPaycheckRemaining = (paycheckId) => {
    const paycheck = currentMonth?.paychecks?.find(p => p.id === paycheckId);
    return paycheck ? paycheck.amount - getPaycheckTotal(paycheckId) : 0;
  };

  const getTotalIncome = () => {
    return currentMonth?.paychecks?.reduce((sum, paycheck) => sum + paycheck.amount, 0) || 0;
  };

  const getTotalExpenses = () => {
    return currentMonth?.bills?.reduce((sum, bill) => sum + bill.amount, 0) || 0;
  };

  // Get historical data
  const getHistoricalData = () => {
    return Object.values(data.months).map(month => ({
      month: `${month.name} ${month.year}`,
      income: month.paychecks.reduce((sum, p) => sum + p.amount, 0),
      expenses: month.bills.reduce((sum, b) => sum + b.amount, 0),
      remaining: month.paychecks.reduce((sum, p) => sum + p.amount, 0) - month.bills.reduce((sum, b) => sum + b.amount, 0)
    }));
  };

  // Subscription Management Functions
  const addNewSubscription = () => {
    if (!newSubscription.name || !newSubscription.amount || !newSubscription.provider) return;
    
    const subscription = {
      id: `sub-${Date.now()}`,
      name: newSubscription.name,
      amount: parseFloat(newSubscription.amount),
      billingCycle: newSubscription.billingCycle,
      nextBilling: newSubscription.nextBilling || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      category: newSubscription.category,
      status: 'active',
      provider: newSubscription.provider,
      cancellationUrl: null,
      description: newSubscription.description || 'Custom subscription',
      connectedAccount: 'Manual Entry',
      lastCharged: new Date().toISOString().split('T')[0],
      autoRenew: true,
      trialEnds: null,
      yearlyDiscount: 0
    };
    
    setData(prev => ({
      ...prev,
      subscriptions: [...prev.subscriptions, subscription]
    }));
    
    setNewSubscription({ 
      name: '', 
      amount: '', 
      provider: '', 
      description: '', 
      billingCycle: 'monthly',
      category: 'Entertainment',
      nextBilling: ''
    });
    setShowAddSubscriptionModal(false);
  };

  const updateSubscriptionStatus = (subscriptionId, status) => {
    setData(prev => ({
      ...prev,
      subscriptions: prev.subscriptions.map(sub =>
        sub.id === subscriptionId ? { ...sub, status } : sub
      )
    }));
  };

  const cancelSubscription = async (subscription) => {
    console.log(`Cancelling subscription: ${subscription.name}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    updateSubscriptionStatus(subscription.id, 'cancelled');
    setShowCancelModal(null);
  };

  const pauseSubscription = (subscriptionId) => {
    updateSubscriptionStatus(subscriptionId, 'paused');
  };

  const resumeSubscription = (subscriptionId) => {
    updateSubscriptionStatus(subscriptionId, 'active');
  };

  // Convert subscription to bill
  const addSubscriptionToBudget = (subscription) => {
    const bill = {
      id: Date.now(),
      name: subscription.name,
      amount: subscription.amount,
      dueDate: new Date(subscription.nextBilling).getDate(),
      category: subscription.category,
      assignedPaycheck: null,
      isPaid: false,
      isSubscription: true,
      subscriptionId: subscription.id
    };
    
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          bills: [...currentMonth.bills, bill]
        }
      }
    }));
  };

  // Calculate subscription totals
  const getActiveSubscriptionsTotal = () => {
    return data?.subscriptions
      ?.filter(sub => sub.status === 'active')
      ?.reduce((sum, sub) => sum + sub.amount, 0) || 0;
  };

  const getYearlySubscriptionSavings = () => {
    return data?.subscriptions
      ?.filter(sub => sub.status === 'active' && sub.yearlyDiscount > 0)
      ?.reduce((sum, sub) => sum + sub.yearlyDiscount, 0) || 0;
  };

  // Connected Accounts Management
  const addConnectedAccount = () => {
    if (!newAccount.name || !newAccount.provider || !newAccount.last4) return;
    
    const account = {
      id: `acc-${Date.now()}`,
      type: newAccount.type,
      name: newAccount.name,
      last4: newAccount.last4,
      provider: newAccount.provider,
      status: 'connected',
      connectedAt: new Date().toISOString().split('T')[0]
    };
    
    setData(prev => ({
      ...prev,
      connectedAccounts: [...prev.connectedAccounts, account]
    }));
    
    setNewAccount({ name: '', type: 'checking', provider: '', last4: '' });
    setShowAddAccountModal(false);
  };

  const startEditAccount = (account) => {
    setEditingAccount({ ...account });
  };

  const saveAccountEdit = () => {
    setData(prev => ({
      ...prev,
      connectedAccounts: prev.connectedAccounts.map(account =>
        account.id === editingAccount.id ? editingAccount : account
      )
    }));
    setEditingAccount(null);
  };

  const deleteConnectedAccount = (accountId) => {
    setData(prev => ({
      ...prev,
      connectedAccounts: prev.connectedAccounts.filter(account => account.id !== accountId)
    }));
  };

  // User Management Functions
  const updateUser = (updates) => {
    setData(prev => ({
      ...prev,
      user: { ...prev.user, ...updates }
    }));
  };

  const startEditUser = () => {
    if (data?.user) {
      setEditingUser({ ...data.user });
    }
  };

  const saveUserEdit = () => {
    updateUser(editingUser);
    setEditingUser(null);
  };

  const cancelUserEdit = () => {
    setEditingUser(null);
  };

  const addNewUser = () => {
    if (!newUser.name || !newUser.email) return;
    
    const userId = `user-${Date.now()}`;
    const userData = {
      id: userId,
      name: newUser.name,
      email: newUser.email,
      company: newUser.company || 'N/A',
      createdAt: new Date().toISOString().split('T')[0],
      settings: {
        notifications: true,
        darkMode: false,
        currency: 'USD'
      }
    };
    
    // Create new user data structure
    const newUserData = {
      user: userData,
      currentMonthId: 'current-month',
      months: {
        'current-month': {
          id: 'current-month',
          name: new Date().toLocaleDateString('en-US', { month: 'long' }),
          year: new Date().getFullYear(),
          bills: [],
          paychecks: []
        }
      },
      subscriptions: [],
      connectedAccounts: []
    };
    
    // In a real app, you'd save this to a database with the user ID
    // For now, we'll just switch to this new user
    setData(newUserData);
    setNewUser({ name: '', email: '', company: '' });
    setShowAddUserModal(false);
    setShowUserManagement(false);
  };

  const deleteCurrentUser = () => {
    // In a real app, you'd delete from database and redirect to login
    // For demo purposes, we'll create a fresh user
    const freshUserData = {
      user: {
        id: 'user-demo',
        name: 'Demo User',
        email: 'demo@example.com',
        company: 'Demo Company',
        createdAt: new Date().toISOString().split('T')[0],
        settings: {
          notifications: true,
          darkMode: false,
          currency: 'USD'
        }
      },
      currentMonthId: 'demo-month',
      months: {
        'demo-month': {
          id: 'demo-month',
          name: new Date().toLocaleDateString('en-US', { month: 'long' }),
          year: new Date().getFullYear(),
          bills: [],
          paychecks: []
        }
      },
      subscriptions: [],
      connectedAccounts: []
    };
    
    setData(freshUserData);
    setShowDeleteUserModal(false);
    setShowUserManagement(false);
    setShowUserProfile(false);
  };

  // Toggle bill paid status
  const toggleBillPaid = (billId, isPaid) => {
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          bills: currentMonth.bills.map(bill => 
            bill.id === billId 
              ? { ...bill, isPaid: isPaid, actualAmount: isPaid ? bill.actualAmount : null }
              : bill
          )
        }
      }
    }));
  };

  // Update actual amount for a bill
  const updateActualAmount = (billId, actualAmount) => {
    setData(prev => ({
      ...prev,
      months: {
        ...prev.months,
        [data.currentMonthId]: {
          ...currentMonth,
          bills: currentMonth.bills.map(bill => 
            bill.id === billId 
              ? { ...bill, actualAmount: actualAmount }
              : bill
          )
        }
      }
    }));
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isDarkMode = data?.user?.settings?.darkMode || false;

  // Don't create styles if data is null
  if (!data) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
        color: 'white',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '20px'}}>⏳</div>
          <h2>Loading FinanceHub Pro...</h2>
          <p>Connecting to cloud storage...</p>
          {isLoading && <p style={{fontSize: '14px', opacity: 0.7}}>Please wait...</p>}
        </div>
      </div>
    );
  }

  // Validate data structure
  if (!data.user || !data.months || !data.currentMonthId) {
    console.error('Invalid data structure:', data);
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        color: 'white',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '20px'}}>⚠️</div>
          <h2>Data Error</h2>
          <p>Unable to load your financial data.</p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: 'white',
              color: '#ef4444',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              marginTop: '20px'
            }}
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }

  const styles = {
    container: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      background: isDarkMode 
        ? 'linear-gradient(135deg, #1a202c 0%, #2d3748 100%)'
        : 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
      minHeight: '100vh',
      padding: '20px',
      transition: 'all 0.3s ease'
    },
    header: {
      textAlign: 'center',
      marginBottom: '30px',
      color: 'white',
      position: 'relative'
    },
    title: {
      fontSize: '32px',
      fontWeight: '700',
      marginBottom: '10px',
      textShadow: '0 2px 4px rgba(0,0,0,0.3)'
    },
    userButton: {
      position: 'absolute',
      top: 0,
      right: 0,
      backgroundColor: 'rgba(255,255,255,0.2)',
      color: 'white',
      border: 'none',
      padding: '10px 15px',
      borderRadius: '25px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      backdropFilter: 'blur(10px)'
    },
    monthSelector: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '20px',
      flexWrap: 'wrap'
    },
    monthButton: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      color: 'white',
      border: 'none',
      padding: '8px 16px',
      borderRadius: '20px',
      cursor: 'pointer',
      fontSize: '14px',
      transition: 'all 0.3s ease',
      backdropFilter: 'blur(10px)'
    },
    monthButtonActive: {
      backgroundColor: 'rgba(255,255,255,0.9)',
      color: isDarkMode ? '#4f46e5' : '#4f46e5',
      transform: 'translateY(-2px)'
    },
    newMonthButton: {
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      padding: '8px 16px',
      borderRadius: '20px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500'
    },
    nav: {
      display: 'flex',
      justifyContent: 'center',
      gap: '10px',
      marginBottom: '30px',
      flexWrap: 'wrap'
    },
    navButton: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '25px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      transition: 'all 0.3s ease',
      backdropFilter: 'blur(10px)'
    },
    navButtonActive: {
      backgroundColor: 'rgba(255,255,255,0.9)',
      color: isDarkMode ? '#4f46e5' : '#4f46e5',
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
    },
    card: {
      backgroundColor: isDarkMode 
        ? 'rgba(45, 55, 72, 0.95)' 
        : 'rgba(255,255,255,0.95)',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      borderRadius: '20px',
      padding: '25px',
      marginBottom: '20px',
      boxShadow: isDarkMode 
        ? '0 8px 32px rgba(0,0,0,0.3)' 
        : '0 8px 32px rgba(0,0,0,0.1)',
      backdropFilter: 'blur(10px)',
      border: isDarkMode 
        ? '1px solid rgba(255,255,255,0.1)' 
        : '1px solid rgba(255,255,255,0.2)',
      transition: 'all 0.3s ease'
    },
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    },
    modalContent: {
      backgroundColor: isDarkMode ? '#2d3748' : 'white',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      borderRadius: '16px',
      padding: '30px',
      maxWidth: '500px',
      width: '90%',
      maxHeight: '80vh',
      overflowY: 'auto',
      transition: 'all 0.3s ease'
    },
    modalTitle: {
      fontSize: '24px',
      fontWeight: '600',
      marginBottom: '20px',
      color: isDarkMode ? '#f7fafc' : '#2c3e50'
    },
    formSection: {
      marginBottom: '30px'
    },
    formTitle: {
      fontSize: '20px',
      fontWeight: '600',
      marginBottom: '15px',
      color: '#2c3e50'
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '15px',
      marginBottom: '15px'
    },
    input: {
      padding: '12px 15px',
      border: isDarkMode ? '2px solid #4a5568' : '2px solid #e0e0e0',
      backgroundColor: isDarkMode ? '#1a202c' : 'white',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      borderRadius: '8px',
      fontSize: '14px',
      transition: 'border-color 0.3s ease',
      outline: 'none'
    },
    inputFocus: {
      borderColor: '#4f46e5'
    },
    select: {
      padding: '12px 15px',
      border: isDarkMode ? '2px solid #4a5568' : '2px solid #e0e0e0',
      backgroundColor: isDarkMode ? '#1a202c' : 'white',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      borderRadius: '8px',
      fontSize: '14px',
      cursor: 'pointer'
    },
    button: {
      backgroundColor: '#4f46e5',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      margin: '5px'
    },
    buttonSecondary: {
      backgroundColor: isDarkMode ? '#4a5568' : '#95a5a6',
      color: 'white'
    },
    buttonDanger: {
      backgroundColor: '#ef4444',
      color: 'white'
    },
    buttonSuccess: {
      backgroundColor: '#10b981',
      color: 'white'
    },
    buttonWarning: {
      backgroundColor: '#f59e0b',
      color: 'white'
    },
    editButton: {
      backgroundColor: '#0ea5e9',
      color: 'white',
      border: 'none',
      padding: '6px 12px',
      borderRadius: '6px',
      fontSize: '12px',
      cursor: 'pointer',
      marginLeft: '5px'
    },
    deleteButton: {
      backgroundColor: '#ef4444',
      color: 'white',
      border: 'none',
      padding: '6px 12px',
      borderRadius: '6px',
      fontSize: '12px',
      cursor: 'pointer',
      marginLeft: '5px'
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '20px',
      marginBottom: '30px'
    },
    statCard: {
      background: isDarkMode 
        ? 'linear-gradient(135deg, #4c51bf 0%, #065f46 100%)'
        : 'linear-gradient(135deg, #4f46e5 0%, #10b981 100%)',
      color: 'white',
      borderRadius: '16px',
      padding: '20px',
      textAlign: 'center',
      boxShadow: isDarkMode 
        ? '0 4px 20px rgba(79, 70, 229, 0.2)'
        : '0 4px 20px rgba(79, 70, 229, 0.3)',
      transition: 'transform 0.3s ease',
      cursor: 'pointer'
    },
    statCardHover: {
      transform: 'translateY(-5px)'
    },
    statValue: {
      fontSize: '24px',
      fontWeight: '700',
      marginBottom: '5px'
    },
    statLabel: {
      fontSize: '14px',
      opacity: '0.9'
    },
    paycheckGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
      gap: '25px',
      marginBottom: '30px'
    },
    paycheckCard: {
      backgroundColor: isDarkMode 
        ? 'rgba(45, 55, 72, 0.95)'
        : 'rgba(255,255,255,0.95)',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      borderRadius: '16px',
      padding: '20px',
      boxShadow: isDarkMode
        ? '0 6px 25px rgba(0,0,0,0.3)'
        : '0 6px 25px rgba(0,0,0,0.1)',
      border: isDarkMode
        ? '1px solid rgba(255,255,255,0.1)'
        : '1px solid rgba(255,255,255,0.3)',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.3s ease'
    },
    paycheckHeader: {
      borderBottom: isDarkMode ? '2px solid #4f46e5' : '2px solid #4f46e5',
      paddingBottom: '15px',
      marginBottom: '15px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    paycheckTitle: {
      fontSize: '18px',
      fontWeight: '600',
      color: isDarkMode ? '#f7fafc' : '#2c3e50',
      marginBottom: '5px'
    },
    paycheckAmount: {
      fontSize: '24px',
      fontWeight: '700',
      color: '#10b981'
    },
    billsList: {
      maxHeight: '300px',
      overflowY: 'auto'
    },
    billItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: isDarkMode ? '1px solid #4a5568' : '1px solid #eee',
      transition: 'all 0.3s ease'
    },
    billName: {
      fontWeight: '500',
      color: isDarkMode ? '#e2e8f0' : '#2c3e50',
      flex: 1
    },
    billAmount: {
      fontWeight: '600',
      color: '#ef4444'
    },
    remainingAmount: {
      textAlign: 'center',
      marginTop: '15px',
      padding: '10px',
      borderRadius: '8px',
      fontWeight: '600'
    },
    positiveRemaining: {
      backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.2)' : '#d5f4e6',
      color: '#10b981'
    },
    negativeRemaining: {
      backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.2)' : '#fadbd8',
      color: '#ef4444'
    },
    unassignedSection: {
      backgroundColor: isDarkMode ? 'rgba(245, 158, 11, 0.1)' : '#fff3cd',
      border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid #ffeaa7',
      borderRadius: '12px',
      padding: '20px',
      marginTop: '20px'
    },
    unassignedTitle: {
      color: isDarkMode ? '#f59e0b' : '#856404',
      fontSize: '16px',
      fontWeight: '600',
      marginBottom: '15px'
    },
    subscriptionGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
      gap: '20px',
      marginBottom: '30px'
    },
    subscriptionCard: {
      backgroundColor: isDarkMode ? '#2d3748' : 'white',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      borderRadius: '16px',
      padding: '20px',
      boxShadow: isDarkMode
        ? '0 4px 15px rgba(0,0,0,0.3)'
        : '0 4px 15px rgba(0,0,0,0.1)',
      border: isDarkMode ? '1px solid #4a5568' : '1px solid #e0e0e0',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.3s ease'
    },
    subscriptionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: '15px'
    },
    subscriptionName: {
      fontSize: '18px',
      fontWeight: '600',
      color: isDarkMode ? '#f7fafc' : '#2c3e50',
      marginBottom: '5px'
    },
    statusBadge: {
      padding: '4px 12px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: '500',
      textTransform: 'uppercase'
    },
    statusActive: {
      backgroundColor: '#d5f4e6',
      color: '#27ae60'
    },
    statusTrial: {
      backgroundColor: '#fff3cd',
      color: '#856404'
    },
    statusPaused: {
      backgroundColor: '#f8d7da',
      color: '#721c24'
    },
    statusCancelled: {
      backgroundColor: '#e2e3e5',
      color: '#383d41'
    },
    subscriptionDetails: {
      fontSize: '14px',
      color: '#666',
      marginBottom: '15px'
    },
    buttonGroup: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap'
    },
    historicalChart: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '15px',
      marginTop: '20px'
    },
    historicalCard: {
      backgroundColor: isDarkMode ? '#2d3748' : 'white',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      borderRadius: '12px',
      padding: '15px',
      textAlign: 'center',
      boxShadow: isDarkMode
        ? '0 2px 8px rgba(0,0,0,0.3)'
        : '0 2px 8px rgba(0,0,0,0.1)',
      transition: 'all 0.3s ease'
    },
    savingsAlert: {
      backgroundColor: isDarkMode ? 'rgba(6, 182, 212, 0.1)' : '#d1ecf1',
      border: isDarkMode ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid #bee5eb',
      borderRadius: '8px',
      padding: '15px',
      marginBottom: '20px',
      color: isDarkMode ? '#67e8f9' : '#0c5460'
    },
    accountCard: {
      backgroundColor: isDarkMode ? '#1a202c' : '#f8f9fa',
      color: isDarkMode ? '#e2e8f0' : '#2d3748',
      padding: '15px',
      borderRadius: '8px',
      marginBottom: '10px',
      border: isDarkMode ? '1px solid #4a5568' : '1px solid #e0e0e0',
      transition: 'all 0.3s ease'
    }
  };

  const renderOverview = () => (
    <div>
      {/* Stats Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{formatCurrency(getTotalIncome())}</div>
          <div style={styles.statLabel}>Total Income</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{formatCurrency(getTotalExpenses())}</div>
          <div style={styles.statLabel}>Total Expenses</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{formatCurrency(getTotalIncome() - getTotalExpenses())}</div>
          <div style={styles.statLabel}>Remaining</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{getUnassignedBills().length}</div>
          <div style={styles.statLabel}>Unassigned Bills</div>
        </div>
      </div>

      {/* Quick subscription summary */}
      <div style={styles.card}>
        <h3>📱 Subscription Summary</h3>
        <p>You have <strong>{data?.subscriptions?.filter(s => s.status === 'active')?.length || 0} active subscriptions</strong> costing <strong>{formatCurrency(getActiveSubscriptionsTotal())}/month</strong></p>
        <button 
          style={styles.button}
          onClick={() => setActiveView('subscriptions')}
        >
          Manage Subscriptions
        </button>
      </div>

      {/* Paycheck Cards */}
      <div style={styles.paycheckGrid}>
        {currentMonth?.paychecks?.map(paycheck => {
          const assignedBills = getBillsByPaycheck(paycheck.id);
          const remaining = getPaycheckRemaining(paycheck.id);
          
          return (
            <div key={paycheck.id} style={styles.paycheckCard}>
              <div style={styles.paycheckHeader}>
                <div>
                  <div style={styles.paycheckTitle}>
                    {paycheck.label} • {formatDate(paycheck.date)}
                  </div>
                  <div style={styles.paycheckAmount}>
                    {formatCurrency(paycheck.amount)}
                  </div>
                </div>
                <div>
                  <button 
                    style={styles.editButton}
                    onClick={() => startEdit(paycheck, 'paycheck')}
                  >
                    Edit
                  </button>
                  <button 
                    style={styles.deleteButton}
                    onClick={() => deletePaycheck(paycheck.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              <div style={styles.billsList}>
                {assignedBills.map(bill => (
                  <div key={bill.id} style={{
                    ...styles.billItem,
                    backgroundColor: bill.isPaid ? (isDarkMode ? 'rgba(16, 185, 129, 0.1)' : '#d5f4e6') : 'transparent',
                    border: bill.isPaid ? (isDarkMode ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid #10b981') : 'none',
                    borderRadius: bill.isPaid ? '8px' : '0',
                    padding: bill.isPaid ? '10px' : '10px 0',
                    flexDirection: 'column',
                    alignItems: 'stretch'
                  }}>
                    <div style={{display: 'flex', alignItems: 'center', marginBottom: bill.isPaid ? '10px' : '0'}}>
                      <input
                        type="checkbox"
                        checked={bill.isPaid || false}
                        onChange={(e) => toggleBillPaid(bill.id, e.target.checked)}
                        style={{marginRight: '10px', transform: 'scale(1.2)'}}
                      />
                      <span style={{
                        ...styles.billName, 
                        display: 'flex', 
                        alignItems: 'center',
                        textDecoration: bill.isPaid ? 'line-through' : 'none',
                        opacity: bill.isPaid ? 0.7 : 1,
                        flex: 1
                      }}>
                        {bill.isSubscription && <span style={{marginRight: '5px'}}>📱</span>}
                        {bill.name}
                      </span>
                      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: '10px'}}>
                        <span style={styles.billAmount}>{formatCurrency(bill.amount)}</span>
                        {bill.isPaid && bill.actualAmount && (
                          <span style={{fontSize: '12px', color: '#10b981', fontWeight: '500'}}>
                            Paid: {formatCurrency(bill.actualAmount)}
                          </span>
                        )}
                      </div>
                      <button 
                        style={styles.editButton}
                        onClick={() => startEdit(bill, 'bill')}
                      >
                        Edit
                      </button>
                      <button 
                        style={styles.deleteButton}
                        onClick={() => assignBillToPaycheck(bill.id, null)}
                      >
                        Remove
                      </button>
                    </div>
                    {bill.isPaid && (
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                        <span style={{fontSize: '14px', color: isDarkMode ? '#a0aec0' : '#666'}}>
                          Actual amount paid:
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Enter amount"
                          value={bill.actualAmount || ''}
                          onChange={(e) => updateActualAmount(bill.id, e.target.value)}
                          style={{
                            ...styles.input,
                            fontSize: '14px',
                            padding: '6px 10px',
                            width: '120px',
                            marginLeft: '10px'
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {assignedBills.length === 0 && (
                  <div style={{textAlign: 'center', color: '#999', padding: '20px'}}>
                    No bills assigned yet
                  </div>
                )}
              </div>
              
              <div style={{
                ...styles.remainingAmount,
                ...(remaining >= 0 ? styles.positiveRemaining : styles.negativeRemaining)
              }}>
                Remaining: {formatCurrency(remaining)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unassigned Bills */}
      {getUnassignedBills().length > 0 && (
        <div style={styles.unassignedSection}>
          <div style={styles.unassignedTitle}>
            📋 Unassigned Bills ({getUnassignedBills().length})
          </div>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '15px'}}>
            {getUnassignedBills().map(bill => (
              <div key={bill.id} style={{
                backgroundColor: 'white',
                padding: '15px',
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div>
                  <div style={{fontWeight: '500', display: 'flex', alignItems: 'center'}}>
                    <input
                      type="checkbox"
                      checked={bill.isPaid || false}
                      onChange={(e) => toggleBillPaid(bill.id, e.target.checked)}
                      style={{marginRight: '10px', transform: 'scale(1.2)'}}
                    />
                    {bill.isSubscription && <span style={{marginRight: '5px'}}>📱</span>}
                    <span style={{
                      textDecoration: bill.isPaid ? 'line-through' : 'none',
                      opacity: bill.isPaid ? 0.7 : 1
                    }}>
                      {bill.name}
                    </span>
                  </div>
                  <div style={{fontSize: '14px', color: '#666'}}>
                    Due: {bill.dueDate}{bill.dueDate === 1 ? 'st' : bill.dueDate === 2 ? 'nd' : bill.dueDate === 3 ? 'rd' : 'th'} • {formatCurrency(bill.amount)}
                  </div>
                </div>
                <div>
                  <select
                    value=""
                    onChange={(e) => assignBillToPaycheck(bill.id, parseInt(e.target.value))}
                    style={styles.select}
                  >
                    <option value="">Assign to...</option>
                    {currentMonth?.paychecks?.map(paycheck => (
                      <option key={paycheck.id} value={paycheck.id}>
                        {paycheck.label}
                      </option>
                    ))}
                  </select>
                  <button 
                    style={styles.editButton}
                    onClick={() => startEdit(bill, 'bill')}
                  >
                    Edit
                  </button>
                  <button 
                    style={styles.deleteButton}
                    onClick={() => deleteBill(bill.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderSubscriptions = () => (
    <div>
      {/* Subscription Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{formatCurrency(getActiveSubscriptionsTotal())}</div>
          <div style={styles.statLabel}>Monthly Subscriptions</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{formatCurrency(getActiveSubscriptionsTotal() * 12)}</div>
          <div style={styles.statLabel}>Yearly Cost</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{data?.subscriptions?.filter(s => s.status === 'active')?.length || 0}</div>
          <div style={styles.statLabel}>Active Subscriptions</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{formatCurrency(getYearlySubscriptionSavings())}</div>
          <div style={styles.statLabel}>Potential Yearly Savings</div>
        </div>
      </div>

      {/* Savings Alert */}
      {getYearlySubscriptionSavings() > 0 && (
        <div style={styles.savingsAlert}>
          <strong>💡 Savings Opportunity!</strong> You could save {formatCurrency(getYearlySubscriptionSavings())} per year by switching to annual billing on some subscriptions.
        </div>
      )}

      {/* Add Subscription Button */}
      <div style={{textAlign: 'center', marginBottom: '20px'}}>
        <button 
          style={{...styles.button, ...styles.buttonSuccess}}
          onClick={() => setShowAddSubscriptionModal(true)}
        >
          + Add New Subscription
        </button>
      </div>

      {/* Subscriptions Grid */}
      <div style={styles.subscriptionGrid}>
        {data?.subscriptions?.map(subscription => (
          <div key={subscription.id} style={styles.subscriptionCard}>
            <div style={styles.subscriptionHeader}>
              <div>
                <div style={styles.subscriptionName}>
                  {subscription.name}
                </div>
                <div style={styles.paycheckAmount}>
                  {formatCurrency(subscription.amount)}/mo
                </div>
              </div>
              <div style={{
                ...styles.statusBadge,
                ...(subscription.status === 'active' ? styles.statusActive :
                   subscription.status === 'trial' ? styles.statusTrial :
                   subscription.status === 'paused' ? styles.statusPaused :
                   styles.statusCancelled)
              }}>
                {subscription.status}
              </div>
            </div>

            <div style={styles.subscriptionDetails}>
              <div><strong>Provider:</strong> {subscription.provider}</div>
              <div><strong>Description:</strong> {subscription.description}</div>
              <div><strong>Next Billing:</strong> {formatDate(subscription.nextBilling)}</div>
              <div><strong>Connected Account:</strong> {subscription.connectedAccount}</div>
              {subscription.trialEnds && (
                <div><strong>⏰ Trial Ends:</strong> {formatDate(subscription.trialEnds)}</div>
              )}
              {subscription.yearlyDiscount > 0 && (
                <div style={{color: '#27ae60', fontWeight: '500'}}>
                  💰 Save {formatCurrency(subscription.yearlyDiscount)}/year with annual billing
                </div>
              )}
            </div>

            <div style={styles.buttonGroup}>
              {subscription.status === 'active' && (
                <>
                  <button 
                    style={{...styles.button, ...styles.buttonDanger}}
                    onClick={() => setShowCancelModal(subscription)}
                  >
                    Cancel
                  </button>
                  <button 
                    style={{...styles.button, ...styles.buttonWarning}}
                    onClick={() => pauseSubscription(subscription.id)}
                  >
                    Pause
                  </button>
                </>
              )}
              
              {subscription.status === 'paused' && (
                <button 
                  style={{...styles.button, ...styles.buttonSuccess}}
                  onClick={() => resumeSubscription(subscription.id)}
                >
                  Resume
                </button>
              )}

              {subscription.status === 'trial' && (
                <button 
                  style={{...styles.button, ...styles.buttonDanger}}
                  onClick={() => setShowCancelModal(subscription)}
                >
                  Cancel Before Trial Ends
                </button>
              )}

              {(subscription.status === 'active' || subscription.status === 'trial') && (
                <button 
                  style={styles.button}
                  onClick={() => addSubscriptionToBudget(subscription)}
                >
                  Add to Budget
                </button>
              )}

              {subscription.cancellationUrl && (
                <button 
                  style={{...styles.button, ...styles.buttonSecondary}}
                  onClick={() => window.open(subscription.cancellationUrl, '_blank')}
                >
                  Manage Online
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderManage = () => (
    <div>
      {/* Copy from Previous Month */}
      {Object.keys(data.months).length > 1 && (
        <div style={styles.card}>
          <div style={styles.formTitle}>🔄 Quick Setup</div>
          <p>Copy recurring bills from your previous month to get started quickly.</p>
          <button style={styles.button} onClick={copyFromPreviousMonth}>
            Copy Bills from Previous Month
          </button>
        </div>
      )}

      {/* Add Bill Form */}
      <div style={styles.card}>
        <div style={styles.formSection}>
          <div style={styles.formTitle}>💰 Add New Bill</div>
          <div style={styles.formGrid}>
            <input
              style={styles.input}
              type="text"
              placeholder="Bill name"
              value={newBill.name}
              onChange={(e) => setNewBill({...newBill, name: e.target.value})}
            />
            <input
              style={styles.input}
              type="number"
              step="0.01"
              placeholder="Amount"
              value={newBill.amount}
              onChange={(e) => setNewBill({...newBill, amount: e.target.value})}
            />
            <input
              style={styles.input}
              type="number"
              min="1"
              max="31"
              placeholder="Due date (1-31)"
              value={newBill.dueDate}
              onChange={(e) => setNewBill({...newBill, dueDate: e.target.value})}
            />
            <select
              style={styles.select}
              value={newBill.category}
              onChange={(e) => setNewBill({...newBill, category: e.target.value})}
            >
              <option value="Housing">Housing</option>
              <option value="Utilities">Utilities</option>
              <option value="Transportation">Transportation</option>
              <option value="Food">Food</option>
              <option value="Health">Health</option>
              <option value="Entertainment">Entertainment</option>
              <option value="Debt">Debt</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <label style={{display: 'flex', alignItems: 'center', marginBottom: '15px'}}>
            <input 
              type="checkbox" 
              checked={newBill.isSubscription}
              onChange={(e) => setNewBill({...newBill, isSubscription: e.target.checked})}
              style={{marginRight: '10px'}}
            />
            This is a subscription
          </label>
          <button style={styles.button} onClick={addBill}>
            Add Bill
          </button>
        </div>
      </div>

      {/* Add Paycheck Form */}
      <div style={styles.card}>
        <div style={styles.formSection}>
          <div style={styles.formTitle}>💵 Add New Paycheck</div>
          <div style={styles.formGrid}>
            <input
              style={styles.input}
              type="date"
              value={newPaycheck.date}
              onChange={(e) => setNewPaycheck({...newPaycheck, date: e.target.value})}
            />
            <input
              style={styles.input}
              type="number"
              step="0.01"
              placeholder="Amount"
              value={newPaycheck.amount}
              onChange={(e) => setNewPaycheck({...newPaycheck, amount: e.target.value})}
            />
            <input
              style={styles.input}
              type="text"
              placeholder="Source (e.g., Equitas Health)"
              value={newPaycheck.source}
              onChange={(e) => setNewPaycheck({...newPaycheck, source: e.target.value})}
            />
            <input
              style={styles.input}
              type="text"
              placeholder="Label (e.g., First Paycheck)"
              value={newPaycheck.label}
              onChange={(e) => setNewPaycheck({...newPaycheck, label: e.target.value})}
            />
          </div>
          <button style={styles.button} onClick={addPaycheck}>
            Add Paycheck
          </button>
        </div>
      </div>
    </div>
  );

  const renderHistory = () => {
    const historicalData = getHistoricalData();
    
    return (
      <div style={styles.card}>
        <h3>📊 Historical Overview</h3>
        <div style={styles.historicalChart}>
          {historicalData.map((month, index) => (
            <div key={index} style={styles.historicalCard}>
              <h4 style={{marginBottom: '10px', color: '#2c3e50'}}>{month.month}</h4>
              <div style={{fontSize: '14px', marginBottom: '5px'}}>
                <strong>Income:</strong> {formatCurrency(month.income)}
              </div>
              <div style={{fontSize: '14px', marginBottom: '5px'}}>
                <strong>Expenses:</strong> {formatCurrency(month.expenses)}
              </div>
              <div style={{
                fontSize: '16px', 
                fontWeight: '600',
                color: month.remaining >= 0 ? '#27ae60' : '#e74c3c'
              }}>
                <strong>Remaining:</strong> {formatCurrency(month.remaining)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderUserProfile = () => (
    <div style={styles.card}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
        <h3>👤 User Profile</h3>
        <div>
          <button 
            style={styles.button}
            onClick={() => setShowUserManagement(true)}
          >
            ⚙️ Manage Users
          </button>
        </div>
      </div>

      {/* Cloud Sync Status */}
      {syncStatus && (
        <div style={{
          backgroundColor: isDarkMode ? 'rgba(6, 182, 212, 0.1)' : '#d1ecf1',
          border: isDarkMode ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid #bee5eb',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '20px',
          color: isDarkMode ? '#67e8f9' : '#0c5460'
        }}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
              <strong>☁️ Cloud Sync Status</strong>
              <div style={{fontSize: '14px', marginTop: '5px'}}>
                {syncStatus.isOnline ? '🟢 Online' : '🔴 Offline'}
                {syncStatus.lastSync && ` • Last sync: ${new Date(syncStatus.lastSync).toLocaleString()}`}
                {syncStatus.pendingChanges > 0 && ` • ${syncStatus.pendingChanges} pending changes`}
              </div>
            </div>
            <div style={{display: 'flex', gap: '10px'}}>
              <button 
                style={{...styles.button, fontSize: '12px', padding: '8px 12px'}}
                onClick={() => setShowSyncModal(true)}
              >
                Sync Status
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSuccess, fontSize: '12px', padding: '8px 12px'}}
                onClick={() => setShowBackupModal(true)}
              >
                Backup/Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {editingUser ? (
        <div>
          <h4>✏️ Edit Profile</h4>
          <div style={styles.formGrid}>
            <input
              style={styles.input}
              type="text"
              placeholder="Full Name"
              value={editingUser.name}
              onChange={(e) => setEditingUser({...editingUser, name: e.target.value})}
            />
            <input
              style={styles.input}
              type="email"
              placeholder="Email Address"
              value={editingUser.email}
              onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
            />
            <input
              style={styles.input}
              type="text"
              placeholder="Company (optional)"
              value={editingUser.company || ''}
              onChange={(e) => setEditingUser({...editingUser, company: e.target.value})}
            />
          </div>
          <div>
            <button style={styles.button} onClick={saveUserEdit}>
              Save Changes
            </button>
            <button 
              style={{...styles.button, ...styles.buttonSecondary}} 
              onClick={cancelUserEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{marginBottom: '20px'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
              <div>
                <div><strong>Name:</strong> {data?.user?.name || 'N/A'}</div>
                <div><strong>Email:</strong> {data?.user?.email || 'N/A'}</div>
                <div><strong>Company:</strong> {data?.user?.company || 'N/A'}</div>
                <div><strong>Member Since:</strong> {formatDate(data?.user?.createdAt || new Date())}</div>
              </div>
              <div>
                <button 
                  style={styles.editButton}
                  onClick={startEditUser}
                >
                  Edit Profile
                </button>
                <button 
                  style={styles.deleteButton}
                  onClick={() => setShowDeleteUserModal(true)}
                >
                  Delete User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <h4>🔗 Connected Accounts</h4>
      <div style={{marginBottom: '15px'}}>
        <div style={{
          backgroundColor: isDarkMode ? 'rgba(245, 158, 11, 0.1)' : '#fff3cd',
          border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid #ffeaa7',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '15px',
          color: isDarkMode ? '#f59e0b' : '#856404'
        }}>
          <strong>⚠️ For Demo/Personal Use Only</strong><br />
          This is for tracking your accounts manually. Never enter real banking credentials in any app unless it's from your actual bank or uses certified services like Plaid.
        </div>
        
        <button 
          style={{...styles.button, ...styles.buttonSuccess}}
          onClick={() => setShowAddAccountModal(true)}
        >
          + Add Account (Manual)
        </button>
      </div>

      <div style={{marginBottom: '20px'}}>
        {data.connectedAccounts.length > 0 ? (
          data.connectedAccounts.map(account => (
            <div key={account.id} style={{
              ...styles.accountCard,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              {editingAccount && editingAccount.id === account.id ? (
                <div style={{flex: 1}}>
                  <div style={styles.formGrid}>
                    <input
                      style={styles.input}
                      type="text"
                      placeholder="Account name"
                      value={editingAccount.name}
                      onChange={(e) => setEditingAccount({...editingAccount, name: e.target.value})}
                    />
                    <select
                      style={styles.select}
                      value={editingAccount.type}
                      onChange={(e) => setEditingAccount({...editingAccount, type: e.target.value})}
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                      <option value="credit_card">Credit Card</option>
                      <option value="investment">Investment</option>
                    </select>
                    <input
                      style={styles.input}
                      type="text"
                      placeholder="Bank/Provider"
                      value={editingAccount.provider}
                      onChange={(e) => setEditingAccount({...editingAccount, provider: e.target.value})}
                    />
                    <input
                      style={styles.input}
                      type="text"
                      placeholder="Last 4 digits"
                      maxLength="4"
                      value={editingAccount.last4}
                      onChange={(e) => setEditingAccount({...editingAccount, last4: e.target.value.replace(/\D/g, '')})}
                    />
                  </div>
                  <div style={{marginTop: '10px'}}>
                    <button style={styles.button} onClick={saveAccountEdit}>
                      Save
                    </button>
                    <button 
                      style={{...styles.button, ...styles.buttonSecondary}}
                      onClick={() => setEditingAccount(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div><strong>{account.name}</strong> ****{account.last4}</div>
                    <div style={{fontSize: '14px', opacity: '0.7'}}>
                      {account.provider} • {account.type.replace('_', ' ')}
                    </div>
                  </div>
                  <div>
                    <div style={{
                      ...styles.statusBadge,
                      ...styles.statusActive,
                      marginBottom: '5px'
                    }}>
                      Manual Entry
                    </div>
                    <div>
                      <button 
                        style={styles.editButton}
                        onClick={() => startEditAccount(account)}
                      >
                        Edit
                      </button>
                      <button 
                        style={styles.deleteButton}
                        onClick={() => deleteConnectedAccount(account.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))
        ) : (
          <div style={{textAlign: 'center', color: isDarkMode ? '#a0aec0' : '#666', padding: '20px'}}>
            No connected accounts yet. Add your accounts manually for tracking.
          </div>
        )}
      </div>

      <h4>⚙️ Settings</h4>
      <div>
        <label style={{display: 'flex', alignItems: 'center', marginBottom: '10px'}}>
          <input 
            type="checkbox" 
            checked={data?.user?.settings?.notifications || false} 
            onChange={(e) => updateUser({
              settings: { ...data?.user?.settings, notifications: e.target.checked }
            })}
            style={{marginRight: '10px'}} 
          />
          Email Notifications
        </label>
        <label style={{display: 'flex', alignItems: 'center', marginBottom: '10px'}}>
          <input 
            type="checkbox" 
            checked={data?.user?.settings?.darkMode || false} 
            onChange={(e) => updateUser({
              settings: { ...data?.user?.settings, darkMode: e.target.checked }
            })}
            style={{marginRight: '10px'}} 
          />
          Dark Mode
        </label>
      </div>
    </div>
  );



  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button 
          style={styles.userButton}
          onClick={() => setShowUserProfile(!showUserProfile)}
        >
          👤 {data?.user?.name || 'User'}
        </button>
        <h1 style={styles.title}>💼 FinanceHub Pro</h1>
        <p style={{fontSize: '16px', opacity: '0.9'}}>
          Complete Financial Management • Subscriptions • Budgeting
        </p>
      </div>

      {/* Month Selector */}
      <div style={styles.monthSelector}>
        {Object.values(data.months)
          .sort((a, b) => new Date(`${a.year}-${a.name}`) - new Date(`${b.year}-${b.name}`))
          .map(month => (
            <button
              key={month.id}
              style={{
                ...styles.monthButton,
                ...(data.currentMonthId === month.id ? styles.monthButtonActive : {})
              }}
              onClick={() => switchMonth(month.id)}
            >
              {month.name} {month.year}
            </button>
          ))}
        <button
          style={styles.newMonthButton}
          onClick={() => setShowNewMonthForm(true)}
        >
          + New Month
        </button>
      </div>

      {/* Navigation */}
      <div style={styles.nav}>
        <button
          style={{
            ...styles.navButton,
            ...(activeView === 'overview' ? styles.navButtonActive : {})
          }}
          onClick={() => setActiveView('overview')}
        >
          📊 Overview
        </button>
        <button
          style={{
            ...styles.navButton,
            ...(activeView === 'subscriptions' ? styles.navButtonActive : {})
          }}
          onClick={() => setActiveView('subscriptions')}
        >
          📱 Subscriptions
        </button>
        <button
          style={{
            ...styles.navButton,
            ...(activeView === 'manage' ? styles.navButtonActive : {})
          }}
          onClick={() => setActiveView('manage')}
        >
          ⚙️ Manage
        </button>
        <button
          style={{
            ...styles.navButton,
            ...(activeView === 'history' ? styles.navButtonActive : {})
          }}
          onClick={() => setActiveView('history')}
        >
          📈 History
        </button>
      </div>

      {/* Main Content */}
      {showUserProfile && renderUserProfile()}
      {activeView === 'overview' && renderOverview()}
      {activeView === 'subscriptions' && renderSubscriptions()}
      {activeView === 'manage' && renderManage()}
      {activeView === 'history' && renderHistory()}

      {/* New Month Modal */}
      {showNewMonthForm && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>🗓️ Create New Month</div>
            <div style={styles.formGrid}>
              <input
                style={styles.input}
                type="text"
                placeholder="Month name (e.g., September)"
                value={newMonth.name}
                onChange={(e) => setNewMonth({...newMonth, name: e.target.value})}
              />
              <input
                style={styles.input}
                type="number"
                placeholder="Year"
                value={newMonth.year}
                onChange={(e) => setNewMonth({...newMonth, year: e.target.value})}
              />
            </div>
            <div>
              <button style={styles.button} onClick={createNewMonth}>
                Create Month
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSecondary}} 
                onClick={() => setShowNewMonthForm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>
              ✏️ Edit {editType === 'bill' ? 'Bill' : 'Paycheck'}
            </div>
            
            {editType === 'bill' ? (
              <div style={styles.formGrid}>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Bill name"
                  value={editingItem.name}
                  onChange={(e) => setEditingItem({...editingItem, name: e.target.value})}
                />
                <input
                  style={styles.input}
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={editingItem.amount}
                  onChange={(e) => setEditingItem({...editingItem, amount: parseFloat(e.target.value) || 0})}
                />
                <input
                  style={styles.input}
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Due date"
                  value={editingItem.dueDate}
                  onChange={(e) => setEditingItem({...editingItem, dueDate: parseInt(e.target.value) || 1})}
                />
                <select
                  style={styles.select}
                  value={editingItem.category}
                  onChange={(e) => setEditingItem({...editingItem, category: e.target.value})}
                >
                  <option value="Housing">Housing</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Transportation">Transportation</option>
                  <option value="Food">Food</option>
                  <option value="Health">Health</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Debt">Debt</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            ) : (
              <div style={styles.formGrid}>
                <input
                  style={styles.input}
                  type="date"
                  value={editingItem.date}
                  onChange={(e) => setEditingItem({...editingItem, date: e.target.value})}
                />
                <input
                  style={styles.input}
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={editingItem.amount}
                  onChange={(e) => setEditingItem({...editingItem, amount: parseFloat(e.target.value) || 0})}
                />
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Source"
                  value={editingItem.source}
                  onChange={(e) => setEditingItem({...editingItem, source: e.target.value})}
                />
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Label"
                  value={editingItem.label}
                  onChange={(e) => setEditingItem({...editingItem, label: e.target.value})}
                />
              </div>
            )}
            
            <div>
              <button style={styles.button} onClick={saveEdit}>
                Save Changes
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSecondary}} 
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Subscription Modal */}
      {showCancelModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <h3>🚫 Cancel Subscription</h3>
            <p>Are you sure you want to cancel <strong>{showCancelModal.name}</strong>?</p>
            <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px', marginBottom: '20px'}}>
              <div><strong>Current Plan:</strong> {showCancelModal.description}</div>
              <div><strong>Monthly Cost:</strong> {formatCurrency(showCancelModal.amount)}</div>
              <div><strong>Next Billing:</strong> {formatDate(showCancelModal.nextBilling)}</div>
              {showCancelModal.trialEnds && (
                <div><strong>Trial Ends:</strong> {formatDate(showCancelModal.trialEnds)}</div>
              )}
            </div>
            <div style={{display: 'flex', gap: '10px'}}>
              <button 
                style={{...styles.button, ...styles.buttonDanger}}
                onClick={() => cancelSubscription(showCancelModal)}
              >
                Yes, Cancel Subscription
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSecondary}}
                onClick={() => setShowCancelModal(null)}
              >
                Keep Subscription
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Management Modal */}
      {showUserManagement && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>👥 User Management</div>
            
            <div style={{marginBottom: '20px'}}>
              <h4>Current User</h4>
              <div style={{
                backgroundColor: '#f8f9fa',
                padding: '15px',
                borderRadius: '8px',
                marginBottom: '15px'
              }}>
                <div><strong>{data?.user?.name || 'N/A'}</strong></div>
                <div style={{fontSize: '14px', color: '#666'}}>{data?.user?.email || 'N/A'}</div>
                <div style={{fontSize: '14px', color: '#666'}}>Member since {formatDate(data?.user?.createdAt || new Date())}</div>
              </div>
            </div>

            <div style={{marginBottom: '20px'}}>
              <h4>🔄 Switch User</h4>
              <p style={{fontSize: '14px', color: '#666', marginBottom: '10px'}}>
                In a full version, you'd see all your users here and could switch between them.
              </p>
              <div style={{
                backgroundColor: '#e9ecef',
                padding: '15px',
                borderRadius: '8px',
                textAlign: 'center',
                color: '#6c757d'
              }}>
                <em>Multi-user switching coming soon!</em>
              </div>
            </div>

            <div style={{marginBottom: '20px'}}>
              <h4>👤 User Actions</h4>
              <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                <button 
                  style={{...styles.button, ...styles.buttonSuccess}}
                  onClick={() => {
                    setShowUserManagement(false);
                    setShowAddUserModal(true);
                  }}
                >
                  + Add New User
                </button>
                <button 
                  style={styles.editButton}
                  onClick={() => {
                    setShowUserManagement(false);
                    startEditUser();
                  }}
                >
                  Edit Current User
                </button>
                <button 
                  style={{...styles.button, ...styles.buttonDanger}}
                  onClick={() => {
                    setShowUserManagement(false);
                    setShowDeleteUserModal(true);
                  }}
                >
                  Delete Current User
                </button>
              </div>
            </div>

            <button 
              style={{...styles.button, ...styles.buttonSecondary}}
              onClick={() => setShowUserManagement(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Add New User Modal */}
      {showAddUserModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>👤 Add New User</div>
            <p style={{marginBottom: '20px', color: '#666'}}>
              Create a new user profile with separate financial data.
            </p>
            
            <div style={styles.formGrid}>
              <input
                style={styles.input}
                type="text"
                placeholder="Full Name *"
                value={newUser.name}
                onChange={(e) => setNewUser({...newUser, name: e.target.value})}
              />
              <input
                style={styles.input}
                type="email"
                placeholder="Email Address *"
                value={newUser.email}
                onChange={(e) => setNewUser({...newUser, email: e.target.value})}
              />
              <input
                style={styles.input}
                type="text"
                placeholder="Company (optional)"
                value={newUser.company}
                onChange={(e) => setNewUser({...newUser, company: e.target.value})}
              />
            </div>
            
            <div style={{display: 'flex', gap: '10px'}}>
              <button 
                style={{...styles.button, ...styles.buttonSuccess}}
                onClick={addNewUser}
                disabled={!newUser.name || !newUser.email}
              >
                Create User
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSecondary}}
                onClick={() => {
                  setShowAddUserModal(false);
                  setNewUser({ name: '', email: '', company: '' });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Subscription Modal */}
      {showAddSubscriptionModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>📱 Add New Subscription</div>
            <p style={{marginBottom: '20px', color: isDarkMode ? '#a0aec0' : '#666'}}>
              Add a subscription you want to track and manage.
            </p>
            
            <div style={styles.formGrid}>
              <input
                style={styles.input}
                type="text"
                placeholder="Subscription Name (e.g., Netflix) *"
                value={newSubscription.name}
                onChange={(e) => setNewSubscription({...newSubscription, name: e.target.value})}
              />
              <input
                style={styles.input}
                type="number"
                step="0.01"
                placeholder="Monthly Amount *"
                value={newSubscription.amount}
                onChange={(e) => setNewSubscription({...newSubscription, amount: e.target.value})}
              />
              <input
                style={styles.input}
                type="text"
                placeholder="Provider (e.g., Netflix Inc.) *"
                value={newSubscription.provider}
                onChange={(e) => setNewSubscription({...newSubscription, provider: e.target.value})}
              />
              <input
                style={styles.input}
                type="text"
                placeholder="Description (e.g., Premium Plan)"
                value={newSubscription.description}
                onChange={(e) => setNewSubscription({...newSubscription, description: e.target.value})}
              />
              <select
                style={styles.select}
                value={newSubscription.category}
                onChange={(e) => setNewSubscription({...newSubscription, category: e.target.value})}
              >
                <option value="Entertainment">Entertainment</option>
                <option value="Productivity">Productivity</option>
                <option value="Health">Health & Fitness</option>
                <option value="Music">Music</option>
                <option value="Gaming">Gaming</option>
                <option value="News">News & Media</option>
                <option value="Utilities">Utilities</option>
                <option value="Other">Other</option>
              </select>
              <select
                style={styles.select}
                value={newSubscription.billingCycle}
                onChange={(e) => setNewSubscription({...newSubscription, billingCycle: e.target.value})}
              >
                <option value="monthly">Monthly</option>
                <option value="annually">Annually</option>
                <option value="weekly">Weekly</option>
              </select>
              <input
                style={styles.input}
                type="date"
                placeholder="Next Billing Date"
                value={newSubscription.nextBilling}
                onChange={(e) => setNewSubscription({...newSubscription, nextBilling: e.target.value})}
              />
            </div>
            
            <div style={{display: 'flex', gap: '10px'}}>
              <button 
                style={{...styles.button, ...styles.buttonSuccess}}
                onClick={addNewSubscription}
                disabled={!newSubscription.name || !newSubscription.amount || !newSubscription.provider}
              >
                Add Subscription
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSecondary}}
                onClick={() => {
                  setShowAddSubscriptionModal(false);
                  setNewSubscription({ 
                    name: '', 
                    amount: '', 
                    provider: '', 
                    description: '', 
                    billingCycle: 'monthly',
                    category: 'Entertainment',
                    nextBilling: ''
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Connected Account Modal */}
      {showAddAccountModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>🔗 Add Connected Account</div>
            <div style={{
              backgroundColor: isDarkMode ? 'rgba(245, 158, 11, 0.1)' : '#fff3cd',
              border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid #ffeaa7',
              borderRadius: '8px',
              padding: '15px',
              marginBottom: '20px',
              color: isDarkMode ? '#f59e0b' : '#856404'
            }}>
              <strong>📝 Manual Entry Only</strong><br />
              Add your account details for personal tracking. This information stays in your browser only.
            </div>
            
            <div style={styles.formGrid}>
              <input
                style={styles.input}
                type="text"
                placeholder="Account Name (e.g., Main Checking) *"
                value={newAccount.name}
                onChange={(e) => setNewAccount({...newAccount, name: e.target.value})}
              />
              <select
                style={styles.select}
                value={newAccount.type}
                onChange={(e) => setNewAccount({...newAccount, type: e.target.value})}
              >
                <option value="checking">Checking Account</option>
                <option value="savings">Savings Account</option>
                <option value="credit_card">Credit Card</option>
                <option value="investment">Investment Account</option>
              </select>
              <input
                style={styles.input}
                type="text"
                placeholder="Bank/Provider (e.g., Wells Fargo) *"
                value={newAccount.provider}
                onChange={(e) => setNewAccount({...newAccount, provider: e.target.value})}
              />
              <input
                style={styles.input}
                type="text"
                placeholder="Last 4 digits (for reference) *"
                maxLength="4"
                value={newAccount.last4}
                onChange={(e) => setNewAccount({...newAccount, last4: e.target.value.replace(/\D/g, '')})}
              />
            </div>
            
            <div style={{display: 'flex', gap: '10px'}}>
              <button 
                style={{...styles.button, ...styles.buttonSuccess}}
                onClick={addConnectedAccount}
                disabled={!newAccount.name || !newAccount.provider || !newAccount.last4}
              >
                Add Account
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSecondary}}
                onClick={() => {
                  setShowAddAccountModal(false);
                  setNewAccount({ name: '', type: 'checking', provider: '', last4: '' });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {showDeleteUserModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>⚠️ Delete User Account</div>
            <p><strong>Warning:</strong> This action cannot be undone!</p>
            
            <div style={{
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              borderRadius: '8px',
              padding: '15px',
              marginBottom: '20px',
              color: '#721c24'
            }}>
              <h4>This will permanently delete:</h4>
              <ul style={{marginLeft: '20px', marginTop: '10px'}}>
                <li>User profile: <strong>{data?.user?.name || 'N/A'}</strong></li>
                <li>All financial data ({Object.keys(data?.months || {}).length} months)</li>
                <li>All bills and paychecks</li>
                <li>All subscription data</li>
                <li>All connected accounts</li>
              </ul>
            </div>

            <div style={{
              backgroundColor: '#d1ecf1',
              border: '1px solid #bee5eb',
              borderRadius: '8px',
              padding: '15px',
              marginBottom: '20px',
              color: '#0c5460'
            }}>
              <strong>💡 Alternative:</strong> Consider creating a new user instead if you just want to start fresh while keeping this data.
            </div>

            <div style={{display: 'flex', gap: '10px'}}>
              <button 
                style={{...styles.button, ...styles.buttonDanger}}
                onClick={deleteCurrentUser}
              >
                Yes, Delete Everything
              </button>
              <button 
                style={{...styles.button, ...styles.buttonSecondary}}
                onClick={() => setShowDeleteUserModal(false)}
              >
                Cancel - Keep User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cloud Sync Status Modal */}
      {showSyncModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>☁️ Cloud Sync Status</div>
            
            {syncStatus && (
              <div style={{marginBottom: '20px'}}>
                <div style={{
                  backgroundColor: isDarkMode ? 'rgba(45, 55, 72, 0.5)' : '#f8f9fa',
                  padding: '15px',
                  borderRadius: '8px',
                  marginBottom: '15px'
                }}>
                  <h4>📊 Sync Information</h4>
                  <div style={{fontSize: '14px', lineHeight: '1.6'}}>
                    <div><strong>Status:</strong> {syncStatus.isOnline ? '🟢 Online' : '🔴 Offline'}</div>
                    <div><strong>User ID:</strong> {syncStatus.userId}</div>
                    <div><strong>Last Sync:</strong> {syncStatus.lastSync ? new Date(syncStatus.lastSync).toLocaleString() : 'Never'}</div>
                    <div><strong>Pending Changes:</strong> {syncStatus.pendingChanges}</div>
                    <div><strong>LocalStorage:</strong> {syncStatus.localStorageAvailable ? '✅ Available' : '❌ Not Available'}</div>
                    <div><strong>SessionStorage:</strong> {syncStatus.sessionStorageAvailable ? '✅ Available' : '❌ Not Available'}</div>
                  </div>
                </div>

                {/* User ID Management Section */}
                <div style={{
                  backgroundColor: isDarkMode ? 'rgba(6, 182, 212, 0.1)' : '#d1ecf1',
                  border: isDarkMode ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid #bee5eb',
                  borderRadius: '8px',
                  padding: '15px',
                  marginBottom: '15px',
                  color: isDarkMode ? '#67e8f9' : '#0c5460'
                }}>
                  <h4>🔧 Cross-Device Sync Fix</h4>
                  <p style={{fontSize: '14px', marginBottom: '10px'}}>
                    If your data isn't syncing between devices, you can manually set the same User ID on all devices.
                  </p>
                  
                  <button 
                    style={{...styles.button, fontSize: '12px', padding: '8px 12px', marginBottom: '10px'}}
                    onClick={() => setShowUserIdSection(!showUserIdSection)}
                  >
                    {showUserIdSection ? 'Hide' : 'Show'} User ID Management
                  </button>
                  
                  {showUserIdSection && (
                    <div style={{marginTop: '10px'}}>
                      <div style={{marginBottom: '10px'}}>
                        <label style={{fontSize: '14px', fontWeight: '500'}}>
                          Current User ID: <span style={{fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: '4px'}}>{syncStatus.userId}</span>
                        </label>
                      </div>
                      
                      <div style={{marginBottom: '10px'}}>
                        <input
                          type="text"
                          placeholder="Enter User ID from another device"
                          value={manualUserId}
                          onChange={(e) => setManualUserId(e.target.value)}
                          style={{
                            ...styles.input,
                            fontSize: '12px',
                            padding: '8px 10px',
                            width: '100%',
                            marginBottom: '10px'
                          }}
                        />
                        <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                          <button 
                            style={{...styles.button, ...styles.buttonSuccess, fontSize: '12px', padding: '8px 12px'}}
                            onClick={() => {
                              if (manualUserId && cloudStorage.setUserId(manualUserId)) {
                                setManualUserId('');
                                setSyncStatus(cloudStorage.getSyncStatus());
                                alert('User ID updated! Please refresh the page for changes to take effect.');
                              }
                            }}
                            disabled={!manualUserId}
                          >
                            Set User ID
                          </button>
                          <button 
                            style={{...styles.button, fontSize: '12px', padding: '8px 12px'}}
                            onClick={() => {
                              navigator.clipboard.writeText(syncStatus.userId);
                              alert('User ID copied to clipboard!');
                            }}
                          >
                            Copy Current ID
                          </button>
                        </div>
                      </div>
                      
                      <div style={{
                        backgroundColor: isDarkMode ? 'rgba(245, 158, 11, 0.1)' : '#fff3cd',
                        border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid #ffeaa7',
                        borderRadius: '6px',
                        padding: '10px',
                        fontSize: '12px',
                        color: isDarkMode ? '#f59e0b' : '#856404'
                      }}>
                        <strong>💡 How to sync across devices:</strong><br />
                        1. Copy the User ID from this device<br />
                        2. Open the app on another device<br />
                        3. Go to Cloud Sync Status → User ID Management<br />
                        4. Paste the same User ID and click "Set User ID"<br />
                        5. Refresh both devices
                      </div>
                    </div>
                  )}
                </div>

                <div style={{
                  backgroundColor: isDarkMode ? 'rgba(245, 158, 11, 0.1)' : '#fff3cd',
                  border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid #ffeaa7',
                  borderRadius: '8px',
                  padding: '15px',
                  marginBottom: '15px',
                  color: isDarkMode ? '#f59e0b' : '#856404'
                }}>
                  <strong>🔒 Privacy Protection</strong><br />
                  Your data is isolated by a unique user ID. Other users cannot access your financial information.
                </div>

                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                  <button 
                    style={{...styles.button, ...styles.buttonSuccess}}
                    onClick={async () => {
                      await cloudStorage.syncPendingChanges();
                      setSyncStatus(cloudStorage.getSyncStatus());
                    }}
                    disabled={!syncStatus.isOnline || syncStatus.pendingChanges === 0}
                  >
                    Sync Now
                  </button>
                  <button 
                    style={{...styles.button, ...styles.buttonDanger}}
                    onClick={async () => {
                      const result = await cloudStorage.clearAllData();
                      if (result.success) {
                        window.location.reload();
                      }
                    }}
                  >
                    Clear All Data
                  </button>
                </div>
              </div>
            )}

            <button 
              style={{...styles.button, ...styles.buttonSecondary}}
              onClick={() => setShowSyncModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Backup/Restore Modal */}
      {showBackupModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalTitle}>💾 Backup & Restore</div>
            
            <div style={{marginBottom: '20px'}}>
              <h4>📤 Export Data</h4>
              <p style={{fontSize: '14px', color: isDarkMode ? '#a0aec0' : '#666', marginBottom: '15px'}}>
                Download a backup of your financial data as a JSON file.
              </p>
              <button 
                style={{...styles.button, ...styles.buttonSuccess}}
                onClick={() => cloudStorage.exportData()}
              >
                Export Backup
              </button>
            </div>

            <div style={{marginBottom: '20px'}}>
              <h4>📥 Import Data</h4>
              <p style={{fontSize: '14px', color: isDarkMode ? '#a0aec0' : '#666', marginBottom: '15px'}}>
                Restore your data from a previously exported backup file.
              </p>
              <input
                type="file"
                accept=".json"
                onChange={(e) => setBackupFile(e.target.files[0])}
                style={{marginBottom: '10px'}}
              />
              {importError && (
                <div style={{
                  backgroundColor: '#f8d7da',
                  border: '1px solid #f5c6cb',
                  borderRadius: '8px',
                  padding: '10px',
                  marginBottom: '10px',
                  color: '#721c24',
                  fontSize: '14px'
                }}>
                  {importError}
                </div>
              )}
              <button 
                style={{...styles.button, ...styles.buttonSuccess}}
                onClick={async () => {
                  if (!backupFile) return;
                  try {
                    setImportError(null);
                    const importedData = await cloudStorage.importData(backupFile);
                    setData(importedData);
                    setBackupFile(null);
                    setShowBackupModal(false);
                  } catch (error) {
                    setImportError(error.message);
                  }
                }}
                disabled={!backupFile}
              >
                Import Backup
              </button>
            </div>

            <div style={{
              backgroundColor: isDarkMode ? 'rgba(245, 158, 11, 0.1)' : '#fff3cd',
              border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid #ffeaa7',
              borderRadius: '8px',
              padding: '15px',
              marginBottom: '15px',
              color: isDarkMode ? '#f59e0b' : '#856404'
            }}>
              <strong>⚠️ Important:</strong> Importing will replace your current data. Make sure to export a backup first if needed.
            </div>

            <button 
              style={{...styles.button, ...styles.buttonSecondary}}
              onClick={() => {
                setShowBackupModal(false);
                setBackupFile(null);
                setImportError(null);
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 2000
        }}>
          <div style={{
            backgroundColor: isDarkMode ? '#2d3748' : 'white',
            color: isDarkMode ? '#e2e8f0' : '#2d3748',
            padding: '30px',
            borderRadius: '16px',
            textAlign: 'center'
          }}>
            <div style={{fontSize: '24px', marginBottom: '10px'}}>⏳</div>
            <div>Loading your financial data...</div>
            <div style={{fontSize: '14px', opacity: 0.7, marginTop: '10px'}}>
              Syncing with cloud storage
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceHubPro;