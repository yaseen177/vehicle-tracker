import React, { useState, useEffect, useMemo } from "react";
import { auth, googleProvider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from "firebase/auth";
import { doc, setDoc, getDoc, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDFDocument, rgb } from 'pdf-lib'; 
import QRCode from 'qrcode'; // NEW
import { 
  LineChart, Line, BarChart, Bar, // Added BarChart, Bar
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import "./App.css";

// --- HUGE LIST OF UK INSURERS (Static Data) ---
const UK_INSURERS = [
  { name: "Admiral", domain: "admiral.com" },
  { name: "Aviva", domain: "aviva.co.uk" },
  { name: "Direct Line", domain: "directline.com" },
  { name: "Hastings Direct", domain: "hastingsdirect.com" },
  { name: "Churchill", domain: "churchill.com" },
  { name: "LV= (Liverpool Victoria)", domain: "lv.com" },
  { name: "AXA", domain: "axa.co.uk" },
  { name: "Tesco Bank", domain: "tescobank.com" },
  { name: "Sheila's Wheels", domain: "sheilaswheels.com" },
  { name: "esure", domain: "esure.com" },
  { name: "1st Central", domain: "1stcentralinsurance.com" },
  { name: "Sainsbury's Bank", domain: "sainsburysbank.co.uk" },
  { name: "More Than", domain: "morethan.com" },
  { name: "Quote Me Happy", domain: "quotemehappy.com" },
  { name: "Marshmallow", domain: "marshmallow.com" },
  { name: "Dial Direct", domain: "dialdirect.co.uk" },
  { name: "RAC", domain: "rac.co.uk" },
  { name: "The AA", domain: "theaa.com" },
  { name: "Swinton", domain: "swinton.co.uk" },
  { name: "Saga", domain: "saga.co.uk" },
  { name: "Post Office", domain: "postoffice.co.uk" },
  { name: "John Lewis", domain: "johnlewis.com" },
  { name: "Privilege", domain: "privilege.com" },
  { name: "Bell", domain: "bell.co.uk" },
  { name: "Elephant", domain: "elephant.co.uk" },
  { name: "Diamond", domain: "diamond.co.uk" },
  { name: "Co-op Insurance", domain: "co-opinsurance.co.uk" },
  { name: "Ageas", domain: "ageas.co.uk" },
  { name: "Allianz", domain: "allianz.co.uk" },
  { name: "NFU Mutual", domain: "nfumutual.co.uk" },
  { name: "Zenith", domain: "zenith-insure.com" },
  { name: "M&S Bank", domain: "bank.marksandspencer.com" },
  { name: "Budget", domain: "budgetinsurance.com" },
  { name: "Flow", domain: "flowinsurance.co.uk" },
  { name: "By Miles", domain: "bymiles.co.uk" },
  { name: "Cuvva", domain: "cuvva.com" },
  { name: "Marmalade", domain: "wearemarmalade.co.uk" },
  { name: "Go Skippy", domain: "goskippy.com" },
  { name: "One Call", domain: "onecallinsurance.co.uk" },
  { name: "Performance Direct", domain: "performancedirect.co.uk" },
  { name: "Acorn", domain: "acorninsure.co.uk" }
];


// --- TOAST NOTIFICATION ---
const ToastContext = React.createContext();
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const addToast = (msg, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };
  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className="toast">{t.type === 'success' ? '✅' : '⚠️'} {t.msg}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

function App() {
  return <ToastProvider><MainApp /></ToastProvider>;
}

function MainApp() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("garage");
  const [myVehicles, setMyVehicles] = useState([]);
  const [activeVehicleId, setActiveVehicleId] = useState(null);
  const showToast = React.useContext(ToastContext);

  // Modal State
  const [showAddWizard, setShowAddWizard] = useState(false);

  useEffect(() => onAuthStateChanged(auth, u => {
    setUser(u);
    if (u) loadGarage(u.uid);
  }), []);

  // --- NEW: HANDLE BROWSER "BACK" & SWIPE GESTURES ---
  useEffect(() => {
    // When the user presses Back (or swipes on iPhone), this event fires
    const handlePopState = (event) => {
      // If we are currently looking at a dashboard, close it and go to garage
      if (view === 'dashboard') {
        setView("garage");
        setActiveVehicleId(null);
      } 
      // If the modal is open, close it (optional nice-to-have)
      else if (showAddWizard) {
        setShowAddWizard(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [view, showAddWizard]); // Re-run when view changes

  const loadGarage = (uid) => {
    onSnapshot(collection(db, "users", uid, "vehicles"), (snap) => {
      setMyVehicles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  };

  const activeVehicle = myVehicles.find(v => v.id === activeVehicleId);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); }
  };

  const deleteVehicle = async (vehicleId) => {
    if (window.confirm("Permanently delete this vehicle?")) {
      await deleteDoc(doc(db, "users", user.uid, "vehicles", vehicleId));
      // Go back properly
      if (activeVehicleId === vehicleId) { 
         window.history.back(); 
      }
      showToast("Vehicle deleted.");
    }
  };

  // --- UPDATED NAVIGATION HANDLER ---
  const openVehicle = (id) => {
    setActiveVehicleId(id);
    setView("dashboard");
    // This is the Magic Line: It adds a "fake" page to the browser history
    // So when user swipes back, they don't leave the app.
    window.history.pushState({ view: 'dashboard' }, '', '#dashboard');
  };

  // --- UPDATED BACK BUTTON HANDLER ---
  const handleBack = () => {
    // Instead of setting view manually, we tell browser to go back.
    // This triggers the 'popstate' listener above, which handles the UI update.
    // This keeps the history stack clean.
    window.history.back();
  };

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="app-wrapper fade-in">
      {/* Wizard Modal */}
      {showAddWizard && (
        <AddVehicleWizard 
          user={user} 
          onClose={() => setShowAddWizard(false)} 
          onComplete={() => { setShowAddWizard(false); showToast("Vehicle Added!"); }} 
        />
      )}

      {/* HEADER - CLEANER VERSION */}
      <header className="top-nav">
        <div className="logo" onClick={view !== 'garage' ? () => {setView('garage'); window.history.back()} : null}>
           My Garage {view === 'dashboard' && activeVehicle && <span style={{opacity:0.5, fontWeight:400}}> / {activeVehicle.registration}</span>}
        </div>
        <div style={{display:'flex', gap:'12px'}}>
           {/* BACK BUTTON (Only on Dashboard) */}
           {view === 'dashboard' && <button onClick={handleBack} className="btn btn-secondary">Back</button>}
           
           {/* PROFILE BUTTON (Now the only global action) */}
           <button onClick={() => setView("profile")} className="btn btn-secondary btn-sm" style={{fontSize:'1.2rem', padding:'4px 12px'}}>👤</button>
        </div>
      </header>

      {/* VIEWS */}
      {view === 'garage' && (
        <GarageView 
          vehicles={myVehicles} 
          onOpen={openVehicle} 
          onAddClick={() => setShowAddWizard(true)}
        />
      )}

      {view === 'dashboard' && activeVehicle && (
        <DashboardView 
          user={user} 
          vehicle={activeVehicle} 
          onDelete={() => deleteVehicle(activeVehicle.id)}
          showToast={showToast}
        />
      )}

      {view === 'profile' && (
        <ProfileView 
          user={user} 
          showToast={showToast} 
          onBack={() => setView("garage")}
          onSignOut={() => signOut(auth)} // <-- PASS SIGN OUT HERE
        />
      )}
    </div>
  );
}


// --- VIEWS ---

function LoginScreen({ onLogin }) {
  return (
    <div style={{display:'flex', height:'100vh', alignItems:'center', justifyContent:'center'}}>
      <div className="bento-card fade-in" style={{textAlign:'center', maxWidth:'400px', border:'1px solid var(--border)'}}>
        <h1 style={{fontSize:'2rem', marginBottom:'10px'}}>My Garage</h1>
        <p style={{marginBottom:'30px'}}>The premium tracker for your vehicle history.</p>
        <button onClick={onLogin} className="btn btn-primary btn-full">Sign in with Google</button>
      </div>
    </div>
  );
}

function GarageView({ vehicles, onOpen, onAddClick }) {
  return (
    <div className="fade-in">
      <div className="bento-card" style={{marginBottom:'40px', textAlign:'center', padding:'40px 20px', background:'linear-gradient(180deg, var(--surface) 0%, var(--surface-highlight) 100%)'}}>
        <h2>Track a New Vehicle</h2>
        <p style={{marginBottom:'24px'}}>Add a car to check MOT, Tax, and manage history.</p>
        <button onClick={onAddClick} className="btn btn-primary" style={{padding:'12px 40px', fontSize:'1.1rem'}}>
          + Add Vehicle
        </button>
      </div>

      <div className="garage-grid">
        {vehicles.map(car => (
          <div key={car.id} onClick={() => onOpen(car.id)} className="garage-card">
            <div className="plate-wrapper"><div className="car-plate">{car.registration}</div></div>
            <h2 style={{marginTop:'10px'}}>{car.make}</h2>
            <p>{car.model}</p>
            <div style={{marginTop:'24px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
               <Badge date={car.motExpiry} />
               <div style={{color:'var(--primary)', fontSize:'0.9rem', fontWeight:'600'}}>Manage →</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- UPDATED WIZARD (With Local UK Search) ---
const AddVehicleWizard = ({ user, onClose, onComplete }) => {
  const [step, setStep] = useState(1);
  const [reg, setReg] = useState("");
  const [vehicleData, setVehicleData] = useState(null);
  const [error, setError] = useState(null);
  
  // Insurance State
  const [insurer, setInsurer] = useState(null);
  const [insuranceDate, setInsuranceDate] = useState("");
  
  // Search State
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const LOGO_DEV_PK = import.meta.env.VITE_LOGO_DEV_PK;

  // Top 6 for the Quick Grid
  const commonInsurers = [
    { name: "Admiral", domain: "admiral.com" },
    { name: "Aviva", domain: "aviva.co.uk" },
    { name: "Direct Line", domain: "directline.com" },
    { name: "Hastings Direct", domain: "hastingsdirect.com" },
    { name: "Churchill", domain: "churchill.com" },
    { name: "AXA", domain: "axa.co.uk" }
  ];

  // --- VEHICLE FETCH (Step 1 -> 2) ---
  const fetchVehicle = async () => {
    if(!reg) return;
    setStep(2);
    try {
      const res = await fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: reg })
      });
      if (res.status === 404) throw new Error("Vehicle not found.");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setVehicleData(data);
      setTimeout(() => setStep(3), 2500);
    } catch (err) {
      setError(err.message);
      setStep(1);
    }
  };

  // --- LOCAL SEARCH FILTER (Instant) ---
  useEffect(() => {
    if (searchTerm.length < 1) {
      setSearchResults([]);
      return;
    }
    // Filter the huge UK_INSURERS list
    const matches = UK_INSURERS.filter(ins => 
      ins.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setSearchResults(matches);
  }, [searchTerm]);

  const handleSelectInsurer = (selected) => {
    setInsurer(selected);
    setSearchTerm(selected.name);
    setSearchResults([]); // Close dropdown
  };

  // --- SAVE FINAL DATA ---
  const saveVehicle = async () => {
    if(!vehicleData) return;
    
    // If user typed a custom name that isn't in our list, use that
    const finalProviderName = insurer ? insurer.name : searchTerm;
    const finalProviderLogo = insurer ? insurer.domain : ""; 
    
    const newCar = {
      registration: vehicleData.registration || reg,
      make: vehicleData.make,
      model: vehicleData.model,
      colour: vehicleData.primaryColour,
      engineSize: vehicleData.engineSize, 
      fuelType: vehicleData.fuelType,     
      firstUsedDate: vehicleData.firstUsedDate, 
      manufactureDate: vehicleData.manufactureDate,
      taxExpiry: vehicleData.taxDueDate || "",
      motTests: vehicleData.motTests || [], 
      motExpiry: vehicleData.motTests ? vehicleData.motTests[0].expiryDate : "",
      
      // Insurance Data
      insuranceExpiry: insuranceDate,
      insuranceProvider: finalProviderName,
      insuranceDomain: finalProviderLogo,
      
      addedAt: new Date().toISOString()
    };

    await setDoc(doc(db, "users", user.uid, "vehicles", newCar.registration), newCar);
    onComplete();
  };

  return (
    <div className="modal-overlay">
      <div className="wizard-card">
        <button onClick={onClose} style={{position:'absolute', top:20, right:20, background:'none', border:'none', color:'#666', fontSize:'1.5rem', cursor:'pointer'}}>×</button>

        {/* STEP 1: ENTER REG */}
        {step === 1 && (
          <div className="wizard-step">
            <h2 style={{color:'white'}}>Add a Vehicle</h2>
            <p style={{marginBottom:'20px'}}>Enter the registration number to begin.</p>
            <div className="plate-wrapper" style={{marginBottom:'20px'}}>
              <input 
                className="car-plate" 
                style={{width:'100%', textAlign:'center', background:'transparent', border:'none', outline:'none', color:'black', textTransform:'uppercase'}}
                placeholder="AA19 AAA"
                value={reg}
                onChange={e => setReg(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>
            {error && <p style={{color:'var(--danger)', marginBottom:'15px'}}>{error}</p>}
            <button onClick={fetchVehicle} className="btn btn-primary btn-full">Find Vehicle</button>
          </div>
        )}

        {/* STEP 2: LOADING / SUCCESS */}
        {step === 2 && (
          <div className="wizard-step">
            {!vehicleData ? (
              <div style={{padding:'40px'}}>
                <div className="spinner" style={{margin:'0 auto', width:40, height:40, borderWidth:4}}></div>
                <p style={{marginTop:'20px'}}>Contacting DVLA & DVSA...</p>
              </div>
            ) : (
              <div>
                <h2 style={{color:'white', marginBottom:'20px'}}>Success!</h2>
                <div className="plate-wrapper" style={{transform:'scale(0.8)'}}><div className="car-plate">{vehicleData.registration}</div></div>
                <p style={{color:'white', fontWeight:'bold', marginTop:'10px'}}>{vehicleData.make} {vehicleData.model}</p>
                <div style={{marginTop:'30px', textAlign:'left'}}>
                   <div className="check-row"><span>Vehicle Specs (DVLA)</span><div className="check-icon">✓</div></div>
                   <div className="check-row"><span>MOT History (DVSA)</span><div className="check-icon">✓</div></div>
                   <div className="check-row"><span>Tax Status</span><div className="check-icon">✓</div></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: INSURANCE (Updated with Local List) */}
        {step === 3 && (
          <div className="wizard-step">
             <h2 style={{fontSize:'1.4rem', color:'white'}}>When is your Insurance due?</h2>
             
             <div style={{margin:'20px 0'}}>
                <input 
                  type="date" 
                  style={{fontSize:'1.2rem', padding:'15px', background:'#232730', border:'1px solid var(--primary)', borderRadius:'12px', color:'white', width:'100%', textAlign:'center'}} 
                  value={insuranceDate}
                  onChange={e => setInsuranceDate(e.target.value)}
                />
             </div>

             <h3 style={{fontSize:'1.1rem', marginTop:'30px', textAlign:'left', color:'#9ca3af'}}>Who are you insured with?</h3>
             
             {/* QUICK SELECT GRID (Only show if not searching) */}
             {!searchTerm && (
               <div className="insurer-grid">
                  {commonInsurers.map(ins => (
                    <div 
                      key={ins.name} 
                      className={`insurer-option ${insurer?.name === ins.name ? 'selected' : ''}`}
                      onClick={() => handleSelectInsurer(ins)}
                    >
                      <img 
                        src={`https://img.logo.dev/${ins.domain}?token=${LOGO_DEV_PK}&size=100&format=png`} 
                        alt={ins.name} 
                        style={{maxWidth:'80%', maxHeight:'80%', objectFit:'contain'}} 
                      />
                    </div>
                  ))}
               </div>
             )}

             {/* SEARCH BAR & LOCAL RESULTS */}
             <div style={{position:'relative', marginTop:'15px'}}>
               <input 
                 placeholder="Search other providers (e.g. Sainsbury's)..." 
                 value={searchTerm}
                 onChange={e => { setSearchTerm(e.target.value); setInsurer(null); }}
                 style={{background:'#1f2937', border:'1px solid var(--border)', width:'100%', padding:'12px', borderRadius:'12px', color:'white'}}
               />
               
               {/* Search Results Dropdown */}
               {searchTerm.length >= 1 && searchResults.length > 0 && (
                 <div className="search-results">
                    {searchResults.map((res, i) => (
                      <div 
                        key={i} 
                        className="search-item"
                        onClick={() => handleSelectInsurer(res)}
                      >
                         <img src={`https://img.logo.dev/${res.domain}?token=${LOGO_DEV_PK}&size=60&format=png`} alt="logo" onError={(e) => e.target.style.display='none'} />
                         <span>{res.name}</span>
                      </div>
                    ))}
                 </div>
               )}
             </div>

             <button onClick={saveVehicle} className="btn btn-primary btn-full" style={{marginTop:'25px'}}>
               Complete Setup
             </button>
          </div>
        )}
      </div>
    </div>
  );
};


// --- UPDATED: MILEAGE COMPONENT (Line & Bar Toggle) ---
const MileageAnalysis = ({ motTests }) => {
  const [view, setView] = useState("line"); // 'line' or 'bar'

  // 1. Process Data for LINE Graph (Cumulative)
  const lineData = useMemo(() => {
    if (!motTests || motTests.length === 0) return [];
    return motTests
      .filter(m => m.odometerValue && m.completedDate)
      .map(m => ({
        timestamp: new Date(m.completedDate).getTime(),
        dateStr: new Date(m.completedDate).toLocaleDateString('en-GB', { month:'short', year:'2-digit' }),
        miles: parseInt(m.odometerValue),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [motTests]);

  // 2. Process Data for BAR Graph (Annual Usage)
  const barData = useMemo(() => {
    if (!lineData || lineData.length < 2) return [];

    // Group by Year: Find the MAX mileage recorded in each calendar year
    const byYear = {};
    lineData.forEach(d => {
      const year = new Date(d.timestamp).getFullYear();
      // Keep the highest mileage for that year (ignores lower retest mileages)
      if (!byYear[year] || d.miles > byYear[year]) {
        byYear[year] = d.miles;
      }
    });

    // Calculate difference between years
    const years = Object.keys(byYear).sort();
    const yearlyUsage = [];

    for (let i = 1; i < years.length; i++) {
      const currentYear = years[i];
      const prevYear = years[i-1];
      const diff = byYear[currentYear] - byYear[prevYear];
      
      // Only show if positive (and ignore tiny retest errors crossing year boundaries)
      if (diff > 0) {
        yearlyUsage.push({
          year: currentYear,
          usage: diff
        });
      }
    }
    return yearlyUsage;
  }, [lineData]);

  if (lineData.length < 2) return null;

  // Stats
  const first = lineData[0];
  const last = lineData[lineData.length - 1];
  const yearsDiff = (last.timestamp - first.timestamp) / (1000 * 60 * 60 * 24 * 365);
  const avgMiles = yearsDiff > 0 ? Math.round((last.miles - first.miles) / yearsDiff) : 0;

  // Formatter
  const formatDate = (unixTime) => new Date(unixTime).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

  return (
    <div className="bento-card" style={{ marginTop: '20px', padding: '24px' }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px'}}>
         <div>
            <h3 style={{margin:0, marginBottom:'4px'}}>Mileage Analysis</h3>
            <div style={{fontSize:'0.9rem', color:'#9ca3af'}}>
               Avg: <span style={{color:'var(--primary)', fontWeight:'bold'}}>{avgMiles.toLocaleString()}</span> miles/yr
            </div>
         </div>

         {/* TOGGLE SWITCH */}
         <div style={{background:'#1f2937', padding:'4px', borderRadius:'8px', display:'flex', gap:'4px'}}>
            <button 
              onClick={() => setView("line")}
              style={{
                background: view === 'line' ? '#374151' : 'transparent',
                color: view === 'line' ? 'white' : '#9ca3af',
                border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '0.85rem', cursor:'pointer'
              }}
            >
              📈 Progression
            </button>
            <button 
              onClick={() => setView("bar")}
              style={{
                background: view === 'bar' ? '#374151' : 'transparent',
                color: view === 'bar' ? 'white' : '#9ca3af',
                border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '0.85rem', cursor:'pointer'
              }}
            >
              📊 Annual
            </button>
         </div>
      </div>
      
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          {view === 'line' ? (
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatDate} stroke="#666" tick={{fontSize: 12}} />
              <YAxis stroke="#666" tick={{fontSize: 12}} tickFormatter={(val) => `${(val/1000).toFixed(0)}k`} domain={['auto', 'auto']} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#181b21', border: '1px solid #333' }}
                labelStyle={{ color: '#fff', marginBottom:'5px' }}
                labelFormatter={formatDate}
                formatter={(val) => [`${val.toLocaleString()} mi`, "Total Mileage"]}
              />
              <Line type="monotone" dataKey="miles" stroke="#fbbf24" strokeWidth={3} dot={{r:4, fill:'#fbbf24'}} />
            </LineChart>
          ) : (
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
              <XAxis dataKey="year" stroke="#666" tick={{fontSize: 12}} />
              <YAxis stroke="#666" tick={{fontSize: 12}} tickFormatter={(val) => `${(val/1000).toFixed(0)}k`} />
              <Tooltip 
                cursor={{fill: 'rgba(255,255,255,0.05)'}}
                contentStyle={{ backgroundColor: '#181b21', border: '1px solid #333' }}
                labelStyle={{ color: '#fff', marginBottom:'5px' }}
                formatter={(val) => [`${val.toLocaleString()} mi`, "Driven this Year"]}
              />
              <Bar dataKey="usage" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={60} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};


function DashboardView({ user, vehicle, onDelete, showToast }) {
  const [tab, setTab] = useState("logs");
  const [logs, setLogs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [logFile, setLogFile] = useState(null);
  const [docFile, setDocFile] = useState(null);
  
  // NEW: Share Modal State
  const [shareUrl, setShareUrl] = useState(null);
  const [shareQr, setShareQr] = useState(null);
  const [sharing, setSharing] = useState(false);

  const LOGO_DEV_PK = import.meta.env.VITE_LOGO_DEV_PK;

  useEffect(() => {
    const unsubLogs = onSnapshot(query(collection(db, "users", user.uid, "vehicles", vehicle.id, "logs"), orderBy("date", "desc")), 
      snap => setLogs(snap.docs.map(d => ({id:d.id, ...d.data()}))));
    const unsubDocs = onSnapshot(collection(db, "users", user.uid, "vehicles", vehicle.id, "documents"), 
      snap => setDocs(snap.docs.map(d => ({id:d.id, ...d.data()}))));
    return () => { unsubLogs(); unsubDocs(); };
  }, [vehicle.id]);

  const updateDate = async (field, value) => {
    await updateDoc(doc(db, "users", user.uid, "vehicles", vehicle.id), { [field]: value });
    showToast("Date updated");
    
    // Format readable date
    const niceDate = new Date(value).toLocaleDateString('en-GB');
    const type = field === 'motExpiry' ? 'MOT' : field === 'taxExpiry' ? 'Tax' : 'Insurance';
    
    // Send SMS
    sendUpdateSms(`Your ${vehicle.registration} ${type} due date has been updated to ${niceDate}.`);
  };

  const updateProvider = async (name, domain) => {
    await updateDoc(doc(db, "users", user.uid, "vehicles", vehicle.id), { 
      insuranceProvider: name,
      insuranceDomain: domain
    });
    showToast("Insurance Provider Updated");
  };

  const refreshData = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: vehicle.registration })
      });
      if (!res.ok) throw new Error("Failed to contact server");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const updates = {
        make: data.make, model: data.model, colour: data.primaryColour,
        engineSize: data.engineSize, fuelType: data.fuelType,
        manufactureDate: data.manufactureDate, firstUsedDate: data.firstUsedDate,
        taxExpiry: data.taxDueDate || "", motTests: data.motTests || [],
        motExpiry: data.motTests ? data.motTests[0].expiryDate : "",
        lastRefreshed: new Date().toISOString()
      };
      await updateDoc(doc(db, "users", user.uid, "vehicles", vehicle.id), updates);
      sendUpdateSms(`Vehicle data for ${vehicle.registration} has been refreshed from DVLA/DVSA.`);
      showToast("Vehicle data refreshed!");
    } catch (err) { showToast("Refresh failed: " + err.message, "error"); }
    setRefreshing(false);
  };

  // --- 1. CORE PDF GENERATOR (Returns BLOB, doesn't save) ---
  const createPdfBlob = async () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Header (No QR Code here anymore)
    doc.setFontSize(22);
    doc.setTextColor(40, 40, 40);
    doc.text(`Vehicle History Report`, 14, 20);
    
    // Car Details Box
    doc.setDrawColor(200);
    doc.setFillColor(245, 247, 250);
    doc.rect(14, 30, pageWidth - 28, 40, "F");
    
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(vehicle.registration, 20, 42);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`${vehicle.make} ${vehicle.model} (${vehicle.colour})`, 20, 48);
    doc.text(`Engine: ${vehicle.engineSize || '-'}cc  |  Fuel: ${vehicle.fuelType || '-'}`, 20, 54);
    const manYear = vehicle.firstUsedDate ? new Date(vehicle.firstUsedDate).getFullYear() : 'Unknown';
    doc.text(`Manufactured: ${manYear}`, 20, 60);

    let currentY = 80;

    // Service History
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Service & Maintenance", 14, currentY);
    autoTable(doc, {
      startY: currentY + 5,
      head: [['Date', 'Type', 'Description', 'Cost']],
      body: logs.map(l => [formatDate(l.date), l.type, l.desc, `£${l.cost.toFixed(2)}`]),
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255] }
    });
    currentY = doc.lastAutoTable.finalY + 15;

    // Document Inventory
    doc.text("Document Inventory", 14, currentY);
    const docRows = docs.map(d => [d.name, d.expiry ? formatDate(d.expiry) : 'N/A', "Attached in Bundle"]);
    autoTable(doc, {
      startY: currentY + 5,
      head: [['Document Name', 'Expiry Date', 'Status']],
      body: docRows,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] }
    });
    currentY = doc.lastAutoTable.finalY + 15;

    // MOT History
    doc.text("Recent MOT History", 14, currentY);
    const motRows = (vehicle.motTests || []).slice(0, 10).map(m => {
      const defects = m.defects || [];
      const defectText = defects.length > 0 ? defects.map(d => `• ${d.text} (${d.type})`).join("\n") : "No Advisories";
      return [formatDate(m.completedDate), m.testResult, m.odometerValue ? `${m.odometerValue} ${m.odometerUnit}` : "-", defectText];
    });
    autoTable(doc, {
      startY: currentY + 5,
      head: [['Date', 'Result', 'Mileage', 'Notes / Defects']],
      body: motRows,
      theme: 'grid',
      headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255] },
      columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 20, fontStyle: 'bold' }, 2: { cellWidth: 25 }, 3: { cellWidth: 'auto', fontSize: 8 } }
    });

    // Prepare Attachments
    const allAttachments = [
      ...docs.map(d => ({ type: 'doc', name: d.name, url: d.url, expiry: d.expiry })),
      ...logs.filter(l => l.receipt).map(l => ({ type: 'log', name: `Receipt: ${l.desc}`, url: l.receipt, date: l.date, cost: l.cost, desc: l.desc }))
    ];
    const pdfAttachments = [];
    const imageAttachments = [];

    allAttachments.forEach(item => {
      const isPdf = item.url.toLowerCase().includes('.pdf');
      if (isPdf) pdfAttachments.push(item);
      else if (item.url.match(/\.(jpeg|jpg|png|webp)/i) || item.url.includes('alt=media')) imageAttachments.push(item);
    });

    // Embed Images
    for (const img of imageAttachments) {
      try {
        const imgData = await fetch(img.url).then(res => res.blob()).then(blob => {
           return new Promise((resolve) => {
             const reader = new FileReader();
             reader.onloadend = () => resolve(reader.result);
             reader.readAsDataURL(blob);
           });
        });
        doc.addPage();
        doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.text(`Appendix: ${img.name}`, 14, 20);
        doc.setFontSize(11); doc.setFont("helvetica", "normal");
        if(img.type === 'log') {
           doc.text(`Date: ${formatDate(img.date)}`, 14, 28); doc.text(`Description: ${img.desc}`, 14, 34); doc.text(`Amount: £${img.cost.toFixed(2)}`, 14, 40);
        } else { doc.text(`Expiry Date: ${img.expiry ? formatDate(img.expiry) : 'N/A'}`, 14, 28); }

        const imgProps = doc.getImageProperties(imgData);
        const pdfWidth = pageWidth - 40;
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        if (pdfHeight > pageHeight - 60) {
           const scale = (pageHeight - 60) / pdfHeight;
           doc.addImage(imgData, 'JPEG', 20, 50, pdfWidth * scale, pdfHeight * scale);
        } else { doc.addImage(imgData, 'JPEG', 20, 50, pdfWidth, pdfHeight); }
      } catch (e) { console.error("Error embedding image", e); }
    }

    // Merge PDFs
    const reportBytes = doc.output('arraybuffer');
    const mergedPdf = await PDFDocument.create();
    const reportPdf = await PDFDocument.load(reportBytes);
    const reportPages = await mergedPdf.copyPages(reportPdf, reportPdf.getPageIndices());
    reportPages.forEach((page) => mergedPdf.addPage(page));

    for (const item of pdfAttachments) {
      try {
        const externalPdfBytes = await fetch(item.url).then(res => res.arrayBuffer());
        const externalPdf = await PDFDocument.load(externalPdfBytes);
        const externalPages = await mergedPdf.copyPages(externalPdf, externalPdf.getPageIndices());
        
        const titlePage = mergedPdf.addPage();
        const { width, height } = titlePage.getSize();
        titlePage.drawText(`Appendix: ${item.name}`, { x: 50, y: height - 100, size: 24 });
        if(item.type === 'log') {
          titlePage.drawText(`Date: ${formatDate(item.date)}`, { x: 50, y: height - 150, size: 18 });
          titlePage.drawText(`Description: ${item.desc}`, { x: 50, y: height - 180, size: 18 });
          titlePage.drawText(`Amount: £${item.cost.toFixed(2)}`, { x: 50, y: height - 210, size: 18 });
        } else {
          titlePage.drawText(`Expiry Date: ${item.expiry ? formatDate(item.expiry) : 'N/A'}`, { x: 50, y: height - 150, size: 18 });
        }
        titlePage.drawText(`(Original Document Attached Next)`, { x: 50, y: height - 300, size: 12, color: rgb(0.5, 0.5, 0.5) });
        externalPages.forEach((page) => mergedPdf.addPage(page));
      } catch (err) { console.error("Could not merge PDF:", item.name, err); }
    }

    return await mergedPdf.save(); // Returns Uint8Array
  };

  // --- 2. DOWNLOAD HANDLER ---
  const handleDownloadReport = async () => {
     showToast("Generating PDF...", "success");
     try {
       const pdfBytes = await createPdfBlob();
       const blob = new Blob([pdfBytes], { type: 'application/pdf' });
       const link = document.createElement('a');
       link.href = URL.createObjectURL(blob);
       link.download = `${vehicle.registration}_SaleBundle.pdf`;
       link.click();
       showToast("Download Started");
     } catch (e) { console.error(e); showToast("Failed to generate PDF", "error"); }
  };

  // --- 3. SHARE HANDLER (The New Logic) ---
  const handleShareReport = async () => {
    setSharing(true);
    showToast("Creating Public Link...", "success");
    try {
      // A. Generate PDF
      const pdfBytes = await createPdfBlob();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      // B. Upload to Firebase (Public Folder)
      // Path: public_reports/{vehicleID}.pdf (Overwrites previous so it's always fresh)
      const shareRef = ref(storage, `public_reports/${vehicle.id}_Bundle.pdf`);
      await uploadBytes(shareRef, blob);
      const url = await getDownloadURL(shareRef);
      
      // C. Generate QR Code
      const qrDataUrl = await QRCode.toDataURL(url);
      
      setShareUrl(url);
      setShareQr(qrDataUrl);
      setSharing(false);
      
    } catch (e) { 
      console.error(e); 
      showToast("Share failed: Check Console", "error"); 
      setSharing(false);
    }
  };

  const handleUpload = async (e, type) => {
    e.preventDefault();
    setUploading(true);
    try {
      const form = new FormData(e.target);
      const file = form.get("file");
      if (!file || file.size === 0) throw new Error("Please select a file.");

      const path = type === 'log' ? `receipts/${user.uid}/${vehicle.id}/${Date.now()}_${file.name}` 
                                  : `documents/${user.uid}/${vehicle.id}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      const data = type === 'log' 
        ? { date: form.get("date"), type: form.get("type"), desc: form.get("desc"), cost: parseFloat(form.get("cost")||0), receipt: url }
        : { name: form.get("name"), expiry: form.get("expiry"), url, uploadedAt: new Date().toISOString() };
        
      await addDoc(collection(db, "users", user.uid, "vehicles", vehicle.id, type === 'log' ? "logs" : "documents"), data);
      showToast(type === 'log' ? "Log added" : "Document saved");
      e.target.reset();
      if(type === 'log') setLogFile(null); else setDocFile(null);
    } catch (err) { showToast(err.message, "error"); }
    setUploading(false);
  };

  const manufactureYear = vehicle.firstUsedDate ? new Date(vehicle.firstUsedDate).getFullYear() : (vehicle.manufactureDate ? new Date(vehicle.manufactureDate).getFullYear() : 'Unknown');

  // Add this helper inside DashboardView
const sendUpdateSms = async (msg) => {
  // 1. Get User Profile to check for phone number
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.exists()) {
    const userData = userDoc.data();
    if (userData.phoneNumber && userData.smsEnabled) {
      // 2. Fire and forget (don't wait for it)
      fetch('/api/send-sms', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
           to: userData.phoneNumber,
           body: `My Garage: ${msg}`
        })
      });
    }
  }
};

  return (
    <div className="dashboard-grid fade-in">
      {/* --- SHARE MODAL --- */}
      {shareQr && (
        <div className="modal-overlay" onClick={() => setShareQr(null)}>
           <div className="wizard-card" onClick={e => e.stopPropagation()} style={{textAlign:'center', maxWidth:'350px'}}>
              <h2 style={{color:'white'}}>Scan to View</h2>
              <p style={{marginBottom:'20px'}}>Show this to a buyer. It opens the PDF instantly.</p>
              
              <div style={{background:'white', padding:'20px', borderRadius:'12px', display:'inline-block', marginBottom:'20px'}}>
                 <img src={shareQr} alt="QR Code" style={{width:'200px', height:'200px'}} />
              </div>
              
              <div style={{fontSize:'0.9rem', color:'#999', wordBreak:'break-all'}}>
                 <a href={shareUrl} target="_blank" style={{color:'var(--primary)'}}>Test Link (Click Here)</a>
              </div>
              
              <button onClick={() => setShareQr(null)} className="btn btn-secondary btn-full" style={{marginTop:'20px'}}>Close</button>
           </div>
        </div>
      )}

      <div className="bento-card sidebar-sticky">
         <div className="plate-wrapper"><div className="car-plate">{vehicle.registration}</div></div>
         <h2>{vehicle.make}</h2>
         <p>{vehicle.model}</p>
         
         <div style={{marginTop:'20px', marginBottom:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
             <div className="spec-box"><div className="spec-label">Year</div><div className="spec-val">{manufactureYear}</div></div>
             <div className="spec-box"><div className="spec-label">Engine</div><div className="spec-val">{vehicle.engineSize ? `${vehicle.engineSize}cc` : '-'}</div></div>
             <div className="spec-box"><div className="spec-label">Fuel</div><div className="spec-val">{vehicle.fuelType || '-'}</div></div>
             <div className="spec-box"><div className="spec-label">Colour</div><div className="spec-val">{vehicle.colour}</div></div>
         </div>
         
         <div style={{borderTop: '1px solid var(--border)', paddingTop: '10px'}}>
           <EditableDateRow 
             label="MOT Expiry" 
             value={vehicle.motExpiry} 
             onChange={(val) => updateDate('motExpiry', val)} 
           />
           <EditableDateRow 
             label="Road Tax" 
             value={vehicle.taxExpiry} 
             onChange={(val) => updateDate('taxExpiry', val)} 
           />
           <ExpandableInsuranceRow 
             vehicle={vehicle} 
             logoKey={LOGO_DEV_PK}
             onDateChange={(val) => updateDate('insuranceExpiry', val)}
             onProviderChange={updateProvider}
           />
         </div>
         
         <div style={{marginTop:'30px', display:'flex', flexDirection:'column', gap:'10px'}}>
            <button onClick={refreshData} disabled={refreshing} className="btn btn-secondary btn-full">
               {refreshing ? "Refreshing..." : "🔄 Refresh Vehicle Data"}
            </button>
            
            <div style={{display:'flex', gap:'10px'}}>
                <button onClick={handleDownloadReport} className="btn btn-full" style={{flex:1, background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)', color:'black', border:'none'}}>
                  📥 Download PDF
                </button>
                <button onClick={handleShareReport} disabled={sharing} className="btn btn-secondary" style={{width:'60px', display:'flex', alignItems:'center', justifyContent:'center'}}>
                   {sharing ? <div className="spinner" style={{width:16,height:16}}></div> : "🔗"}
                </button>
            </div>

            <button onClick={onDelete} className="btn btn-danger btn-full btn-sm">Delete Vehicle</button>
         </div>
      </div>

      <div>
        <MileageAnalysis motTests={vehicle.motTests} />

        <div className="tabs" style={{marginTop:'20px'}}>
          <button onClick={() => setTab("logs")} className={`tab-btn ${tab==='logs'?'active':''}`}>Service History</button>
          <button onClick={() => setTab("mot")} className={`tab-btn ${tab==='mot'?'active':''}`}>MOT History</button>
          <button onClick={() => setTab("docs")} className={`tab-btn ${tab==='docs'?'active':''}`}>Documents</button>
        </div>

        {tab === 'logs' && (
          <>
            <form onSubmit={e => handleUpload(e, 'log')} className="bento-card" style={{marginBottom:'24px'}}>
              <h3>Add New Service Log</h3>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px'}}>
                <input type="date" name="date" required />
                <select name="type"><option>Service</option><option>Repair</option><option>Part</option><option>Other</option></select>
              </div>
              <input name="desc" placeholder="Description (e.g. Brake Pads)" required style={{marginBottom:'12px'}} />
              <div style={{display:'grid', gridTemplateColumns:'100px 1fr', gap:'12px'}}>
                <input type="number" step="0.01" name="cost" placeholder="£0.00" />
                <div className={`file-upload-box ${logFile ? 'has-file' : ''}`}>
                   <span>{uploading ? "Uploading..." : (logFile ? `✅ ${logFile}` : "Attach Receipt")}</span>
                   <input type="file" name="file" onChange={(e) => setLogFile(e.target.files[0]?.name)} />
                </div>
              </div>
              <button disabled={uploading} className="btn btn-primary btn-full" style={{marginTop:'12px'}}>
                {uploading ? <div className="spinner"></div> : "Save Entry"}
              </button>
            </form>
            <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
              {logs.length === 0 && <EmptyState text="No logs recorded." />}
              {logs.map(log => (
                <div key={log.id} className="list-item">
                  <div style={{minWidth:'100px', fontWeight:'600', color:'white'}}>{formatDate(log.date)}</div>
                  <div style={{minWidth:'80px'}}><span style={{background:'rgba(255,255,255,0.1)', padding:'4px 8px', borderRadius:'4px', fontSize:'0.8rem'}}>{log.type}</span></div>
                  <div style={{flex:1, color:'var(--text-muted)'}}>{log.desc}</div>
                  <div style={{minWidth:'80px', fontWeight:'700', color:'white'}}>£{log.cost}</div>
                  <div style={{display:'flex', gap:'10px'}}>
                    {log.receipt && <a href={log.receipt} target="_blank" className="btn btn-secondary btn-sm" style={{padding:'6px 10px'}}>View</a>}
                    <button onClick={() => deleteDoc(doc(db, "users", user.uid, "vehicles", vehicle.id, "logs", log.id))} className="btn btn-danger btn-sm" style={{padding:'6px 10px'}}>×</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'mot' && (
          <div className="fade-in">
             {!vehicle.motTests || vehicle.motTests.length === 0 ? <EmptyState text="No MOT history found." /> : vehicle.motTests.map((test, index) => <MotTestCard key={index} test={test} />)}
          </div>
        )}

        {tab === 'docs' && (
          <>
            <form onSubmit={e => handleUpload(e, 'doc')} className="bento-card" style={{marginBottom:'24px'}}>
               <h3>Upload Document</h3>
               <div style={{display:'grid', gap:'12px'}}>
                 <input name="name" placeholder="Name (e.g. V5C)" required />
                 <input type="date" name="expiry" />
                 <div className={`file-upload-box ${docFile ? 'has-file' : ''}`}>
                   <span>{uploading ? "Uploading..." : (docFile ? `✅ ${docFile}` : "Select PDF / Image")}</span>
                   <input type="file" name="file" required onChange={(e) => setDocFile(e.target.files[0]?.name)} />
                 </div>
                 <button disabled={uploading} className="btn btn-primary btn-full">
                    {uploading ? <div className="spinner"></div> : "Save Document"}
                 </button>
               </div>
            </form>
            <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
               {docs.length === 0 && <EmptyState text="No documents." />}
               {docs.map(doc => (
                 <div key={doc.id} className="list-item">
                    <div style={{flex:1}}>
                      <div style={{fontWeight:'600', color:'white'}}>{doc.name}</div>
                      <div style={{fontSize:'0.85rem', color:'var(--text-muted)'}}>{doc.expiry ? `Exp: ${formatDate(doc.expiry)}` : 'No Expiry'}</div>
                    </div>
                    <div style={{display:'flex', gap:'10px'}}>
                      <a href={doc.url} target="_blank" className="btn btn-secondary btn-sm">Open</a>
                      <button onClick={() => deleteDoc(doc(db, "users", user.uid, "vehicles", vehicle.id, "documents", doc.id))} className="btn btn-danger btn-sm">×</button>
                    </div>
                 </div>
               ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- UPDATED INSURANCE ROW (With Local UK Search) ---
const ExpandableInsuranceRow = ({ vehicle, onDateChange, onProviderChange, logoKey }) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredResults, setFilteredResults] = useState([]);

  // Filter Local UK List
  useEffect(() => {
    if (searchTerm.length < 1) {
      setFilteredResults([]);
      return;
    }
    const matches = UK_INSURERS.filter(ins => 
      ins.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredResults(matches);
  }, [searchTerm]);

  const hasProvider = vehicle.insuranceProvider || vehicle.insuranceDomain;

  return (
    <>
      <div className={`editable-row ${expanded ? 'row-expanded' : ''}`}>
        <div className="row-label" style={{flex:1}}>
          <StatusDot date={vehicle.insuranceExpiry} /> Insurance
        </div>
        <div className="insurance-row-container">
            <div className="row-value" style={{position:'relative', flex:1, textAlign:'right'}}>
              {vehicle.insuranceExpiry ? formatDate(vehicle.insuranceExpiry) : <span style={{color:'var(--primary)', fontSize:'0.9rem'}}>Set Date</span>}
              <input type="date" className="hidden-date-input" value={vehicle.insuranceExpiry || ""} onChange={(e) => onDateChange(e.target.value)} />
            </div>
            {/* Always visible expand button */}
            <div className="row-action-area" onClick={() => setExpanded(!expanded)} style={{cursor:'pointer', minWidth:'40px', display:'flex', justifyContent:'center'}}>
              <span className="row-expand-icon">▼</span>
            </div>
        </div>
      </div>

      {expanded && (
        <div className="insurance-details" style={{flexDirection:'column', alignItems:'stretch'}}>
           {!editing && hasProvider && (
             <div style={{display:'flex', alignItems:'center', gap:'16px'}}>
                {vehicle.insuranceDomain ? (
                  <img src={`https://img.logo.dev/${vehicle.insuranceDomain}?token=${logoKey}&size=100&format=png`} alt="Logo" className="insurance-logo-large" />
                ) : (
                  <div className="insurance-logo-large" style={{display:'flex', alignItems:'center', justifyContent:'center', color:'#000', fontWeight:'bold'}}>{vehicle.insuranceProvider.charAt(0)}</div>
                )}
                <div style={{flex:1}}>
                   <h4 style={{color:'white'}}>{vehicle.insuranceProvider}</h4>
                   <p style={{color:'#9ca3af', fontSize:'0.85rem'}}>Policy expires {formatDate(vehicle.insuranceExpiry)}</p>
                </div>
                <button onClick={() => setEditing(true)} style={{background:'none', border:'none', color:'var(--primary)', cursor:'pointer', fontSize:'0.85rem'}}>Edit</button>
             </div>
           )}

           {(!hasProvider || editing) && (
             <div className="insurance-edit-box">
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px'}}>
                   <span style={{fontSize:'0.9rem', fontWeight:'bold'}}>Select Insurer</span>
                   {hasProvider && <button onClick={() => setEditing(false)} style={{background:'none', border:'none', color:'#666'}}>Cancel</button>}
                </div>
                
                <input 
                  placeholder="Search provider (e.g. LV)..." 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{width:'100%', padding:'10px', borderRadius:'6px', border:'1px solid var(--border)', background:'#0f1115', color:'white'}}
                  autoFocus
                />

                {filteredResults.length > 0 && (
                  <div className="search-results" style={{position:'static', marginTop:'10px', maxHeight:'150px'}}>
                     {filteredResults.map((res, i) => (
                       <div key={i} className="search-item" onClick={() => {
                          onProviderChange(res.name, res.domain);
                          setEditing(false);
                          setSearchTerm("");
                       }}>
                          <img src={`https://img.logo.dev/${res.domain}?token=${logoKey}&size=60&format=png`} alt="logo" onError={(e) => e.target.style.display='none'} />
                          <span>{res.name}</span>
                       </div>
                     ))}
                  </div>
                )}
             </div>
           )}
        </div>
      )}
    </>
  );
};

// --- UPDATED MOT CARD (Uses 'defects' array) ---
const MotTestCard = ({ test }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const result = test.testResult || test.status || "UNKNOWN";
  const date = test.completedDate || test.testDate || null;
  const mileage = test.odometerValue ? `${test.odometerValue} ${test.odometerUnit || 'mi'}` : "Unknown Mileage";
  const testNo = test.motTestNumber || "No Ref";
  
  // LOOK FOR DEFECTS
  const defects = test.defects || [];
  const hasDetails = defects.length > 0;

  return (
    <div className={`mot-card ${isOpen ? 'mot-expanded' : ''}`} style={{marginBottom: '16px'}}>
      
      <div 
        className="mot-card-header" 
        onClick={() => setIsOpen(!isOpen)} 
        style={{ cursor: 'pointer', display:'flex', justifyContent:'space-between', width:'100%' }}
      >
        <div>
           <div style={{fontWeight:'700', fontSize:'1.1rem', color:'#fff', marginBottom:'6px'}}>
             {date ? new Date(date).toLocaleDateString('en-GB') : "Unknown Date"}
           </div>
           
           <div className="mot-meta" style={{color:'#94a3b8', fontSize:'0.9rem', display:'flex', gap:'15px'}}>
              <div>Mileage: <span style={{color:'#fff', fontWeight:600}}>{mileage}</span></div>
              <div>Test No: <span style={{color:'#fff', fontWeight:600}}>{testNo}</span></div>
           </div>
        </div>
        
        <div style={{display:'flex', alignItems:'center', gap:'20px'}}>
           <div className={`mot-result ${result === 'PASSED' ? 'result-pass' : 'result-fail'}`} 
                style={{
                  background: result === 'PASSED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  color: result === 'PASSED' ? '#34d399' : '#f87171',
                  border: result === 'PASSED' ? '1px solid #059669' : '1px solid #b91c1c',
                  padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold'
                }}>
             {result}
           </div>

           <div className="mot-expand-icon" style={{color: '#fff', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>
             ▼
           </div>
        </div>
      </div>

      {isOpen && (
        <div className="mot-details" style={{padding:'20px', borderTop:'1px solid rgba(255,255,255,0.1)'}}>
           {defects.length === 0 ? (
             <p style={{fontStyle:'italic', color:'#64748b', margin:0}}>No advisories or failures recorded for this test.</p>
           ) : (
             <div className="rfr-list">
                {defects.map((item, i) => (
                   <div key={i} className="rfr-item" style={{marginBottom:'10px', display:'flex', gap:'10px', alignItems:'flex-start'}}>
                      <span className={`rfr-type ${item.type === 'FAIL' || item.type === 'MAJOR' || item.type === 'DANGEROUS' ? 'type-fail' : 'type-advisory'}`}
                            style={{
                              background: (item.type === 'FAIL' || item.type === 'MAJOR' || item.type === 'DANGEROUS') ? '#b91c1c' : '#ca8a04',
                              color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', minWidth:'80px', textAlign:'center', marginTop:'2px'
                            }}>
                        {item.type}
                      </span>
                      <span style={{color:'#e2e8f0', fontSize:'0.95rem', lineHeight:'1.5'}}>{item.text}</span>
                   </div>
                ))}
             </div>
           )}
        </div>
      )}
    </div>
  );
};

// --- HELPERS ---
const EditableDateRow = ({ label, value, onChange }) => (
  <div className="editable-row">
    <div className="row-label"><StatusDot date={value} /> {label}</div>
    <div className="row-value">{value ? formatDate(value) : <span style={{color:'var(--primary)', fontSize:'0.9rem'}}>Set Date</span>}</div>
    <input type="date" className="hidden-date-input" value={value || ""} onChange={(e) => onChange(e.target.value)} />
  </div>
);

const StatusDot = ({ date }) => {
  if (!date) return <span className="status-dot" style={{background:'var(--border)'}}></span>;
  const d = daysLeft(date);
  const color = d < 0 ? 'dot-red' : d < 30 ? 'dot-orange' : 'dot-green';
  return <span className={`status-dot ${color}`}></span>;
};

const formatDate = (s) => s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const daysLeft = (s) => s ? Math.ceil((new Date(s) - new Date()) / (86400000)) : null;

const Badge = ({ date }) => {
  const d = daysLeft(date);
  if (d === null) return null;
  const color = d < 0 ? 'var(--danger)' : d < 30 ? 'var(--warning)' : 'var(--success)';
  return <span style={{color: color, fontWeight: 700, fontSize:'0.9rem'}}>{d < 0 ? 'Expired' : `${d} days left`}</span>;
};

const EmptyState = ({ text }) => (
  <div style={{textAlign:'center', padding:'40px', color:'var(--text-muted)', border:'1px dashed var(--border)', borderRadius:'12px'}}>
    {text}
  </div>
);

function ProfileView({ user, showToast, onBack }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  // 1. Load existing profile from Firestore when component mounts
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setName(data.displayName || "");
          setPhone(data.phoneNumber || "");
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      } finally {
        setFetching(false);
      }
    };
    loadProfile();
  }, [user.uid]);

  // 2. Save or Update Profile
  const handleSave = async () => {
    // Basic formatting: Remove spaces from phone
    let cleanPhone = phone.replace(/\s+/g, '');
    
    // Auto-fix: If user types "07...", change to "+447..."
    if (cleanPhone.startsWith('07')) {
      cleanPhone = '+44' + cleanPhone.substring(1);
    }

    if (!cleanPhone.startsWith('+44') || cleanPhone.length < 11) {
      showToast("Please enter a valid UK mobile (+44...)", "error");
      return;
    }

    setLoading(true);
    try {
      // Merge: true ensures we don't overwrite other data (like vehicles)
      await setDoc(doc(db, "users", user.uid), {
        displayName: name,
        phoneNumber: cleanPhone,
        smsEnabled: true
      }, { merge: true });

      // Optional: Send a confirmation text if the number changed
      await fetch('/api/send-sms', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
           to: cleanPhone,
           body: `Hi ${name}, your My Garage profile has been updated.`
        })
      });

      showToast("Profile Updated Successfully!");
    } catch (e) {
      console.error(e);
      showToast("Error saving profile", "error");
    }
    setLoading(false);
  };

  if (fetching) return <div className="spinner" style={{margin:'50px auto'}}></div>;

  return (
    <div className="fade-in" style={{maxWidth:'500px', margin:'20px auto', padding:'0 15px'}}>
       {/* BACK BUTTON */}
       <button 
         onClick={onBack} 
         className="btn" 
         style={{background:'transparent', border:'1px solid #333', marginBottom:'20px', display:'flex', alignItems:'center', gap:'8px', color:'#9ca3af'}}
       >
         ← Back to Garage
       </button>

       <div className="bento-card">
          <h2 style={{color:'white'}}>Your Profile</h2>
          <p style={{marginBottom:'24px', color:'#9ca3af'}}>
            Update your details below. We need your mobile number to send you MOT & Tax reminders.
          </p>
          
          <label style={{display:'block', marginBottom:'8px', fontSize:'0.9rem', fontWeight:'bold', color:'var(--text-muted)'}}>
            Full Name
          </label>
          <input 
            value={name} 
            onChange={e => setName(e.target.value)} 
            placeholder="e.g. Joe Bloggs" 
            style={{
              width:'100%', padding:'14px', background:'#0f1115', 
              border:'1px solid var(--border)', color:'white', 
              borderRadius:'8px', marginBottom:'20px', fontSize:'1rem'
            }}
          />

          <label style={{display:'block', marginBottom:'8px', fontSize:'0.9rem', fontWeight:'bold', color:'var(--text-muted)'}}>
            Mobile Number (UK)
          </label>
          <input 
            value={phone} 
            onChange={e => setPhone(e.target.value)} 
            placeholder="+44 7123 456789" 
            style={{
              width:'100%', padding:'14px', background:'#0f1115', 
              border:'1px solid var(--border)', color:'white', 
              borderRadius:'8px', marginBottom:'24px', fontSize:'1rem'
            }}
          />

          <button onClick={handleSave} disabled={loading} className="btn btn-primary btn-full" style={{padding:'14px', fontSize:'1.1rem'}}>
            {loading ? "Saving..." : "Save Changes"}
          </button>

          {/* NEW SIGN OUT BUTTON */}
          <button 
            onClick={onSignOut} 
            className="btn btn-danger btn-full" 
            style={{background:'rgba(220, 38, 38, 0.2)', color:'#f87171', border:'1px solid rgba(220, 38, 38, 0.5)'}}
          >
            Sign Out
          </button>
       </div>
    </div>
  );
}

export default App;