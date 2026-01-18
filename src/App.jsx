import React, { useState, useEffect } from "react";
import { auth, googleProvider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from "firebase/auth";
import { doc, setDoc, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "./App.css";

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
  const [loading, setLoading] = useState(false);
  const showToast = React.useContext(ToastContext);

  useEffect(() => onAuthStateChanged(auth, u => {
    setUser(u);
    if (u) loadGarage(u.uid);
  }), []);

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

  const addNewVehicle = async (reg) => {
    if (!reg) return;
    setLoading(true);
    try {
      const res = await fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: reg })
      });
      if (res.status === 404) throw new Error("Vehicle not found.");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // --- SAVE FULL MOT HISTORY ---
      const newCar = {
        registration: data.registration || reg,
        make: data.make,
        model: data.model,
        colour: data.primaryColour,
        engineSize: data.engineSize, 
        fuelType: data.fuelType,     
        firstUsedDate: data.firstUsedDate, 
        manufactureDate: data.manufactureDate,
        motTests: data.motTests || [], // <--- This array contains the defects/advisories
        
        motExpiry: data.motTests ? data.motTests[0].expiryDate : "",
        taxExpiry: "",
        insuranceExpiry: "",
        addedAt: new Date().toISOString()
      };

      await setDoc(doc(db, "users", user.uid, "vehicles", newCar.registration), newCar);
      showToast("Vehicle Added Successfully");
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  };

  const deleteVehicle = async (vehicleId) => {
    if (window.confirm("Permanently delete this vehicle?")) {
      await deleteDoc(doc(db, "users", user.uid, "vehicles", vehicleId));
      if (activeVehicleId === vehicleId) { setView("garage"); setActiveVehicleId(null); }
      showToast("Vehicle deleted.");
    }
  };

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="app-wrapper fade-in">
      <header className="top-nav">
        <div className="logo" onClick={() => setView("garage")}>
           My Garage {view === 'dashboard' && activeVehicle && <span style={{opacity:0.5, fontWeight:400}}> / {activeVehicle.registration}</span>}
        </div>
        <div style={{display:'flex', gap:'12px'}}>
          {view === 'dashboard' && <button onClick={() => setView("garage")} className="btn btn-secondary">Back</button>}
          <button onClick={() => signOut(auth)} className="btn btn-secondary btn-sm">Sign Out</button>
        </div>
      </header>

      {view === 'garage' && (
        <GarageView 
          vehicles={myVehicles} 
          onOpen={(id) => { setActiveVehicleId(id); setView("dashboard"); }} 
          onAdd={addNewVehicle} 
          loading={loading}
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

function GarageView({ vehicles, onOpen, onAdd, loading }) {
  const [input, setInput] = useState("");
  return (
    <div className="fade-in">
      <div className="bento-card" style={{marginBottom:'40px', textAlign:'center', padding:'40px 20px', background:'linear-gradient(180deg, var(--surface) 0%, var(--surface-highlight) 100%)'}}>
        <h2>Add a Vehicle</h2>
        <p style={{marginBottom:'24px'}}>Enter your UK registration number to track it.</p>
        <div style={{maxWidth:'320px', margin:'0 auto', display:'flex', gap:'12px'}}>
          <input 
            value={input} 
            onChange={e => setInput(e.target.value.toUpperCase())} 
            placeholder="AA19 AAA" 
            style={{textAlign:'center', textTransform:'uppercase', letterSpacing:'1px', marginBottom:0}} 
          />
          <button onClick={() => { onAdd(input); setInput(""); }} disabled={loading} className="btn btn-primary">
            {loading ? <div className="spinner"></div> : "Add"}
          </button>
        </div>
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

function DashboardView({ user, vehicle, onDelete, showToast }) {
  const [tab, setTab] = useState("logs");
  const [logs, setLogs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const unsubLogs = onSnapshot(query(collection(db, "users", user.uid, "vehicles", vehicle.id, "logs"), orderBy("date", "desc")), 
      snap => setLogs(snap.docs.map(d => ({id:d.id, ...d.data()}))));
    const unsubDocs = onSnapshot(collection(db, "users", user.uid, "vehicles", vehicle.id, "documents"), 
      snap => setDocs(snap.docs.map(d => ({id:d.id, ...d.data()}))));
    return () => { unsubLogs(); unsubDocs(); };
  }, [vehicle.id]);

  const updateDate = async (field, value) => {
    await updateDoc(doc(db, "users", user.uid, "vehicles", vehicle.id), { [field]: value });
    showToast(`${field === 'taxExpiry' ? 'Tax' : 'Insurance'} updated`);
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
    } catch (err) { showToast(err.message, "error"); }
    setUploading(false);
  };

  const manufactureYear = vehicle.firstUsedDate ? new Date(vehicle.firstUsedDate).getFullYear() : (vehicle.manufactureDate ? new Date(vehicle.manufactureDate).getFullYear() : 'Unknown');

  return (
    <div className="dashboard-grid fade-in">
      <div className="bento-card sidebar-sticky">
         <div className="plate-wrapper"><div className="car-plate">{vehicle.registration}</div></div>
         <h2>{vehicle.make}</h2>
         <p>{vehicle.model}</p>
         
         <div style={{marginTop:'20px', marginBottom:'20px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
             <div className="spec-box">
                <div className="spec-label">Year</div>
                <div className="spec-val">{manufactureYear}</div>
             </div>
             <div className="spec-box">
                <div className="spec-label">Engine</div>
                <div className="spec-val">{vehicle.engineSize ? `${vehicle.engineSize}cc` : '-'}</div>
             </div>
             <div className="spec-box">
                <div className="spec-label">Fuel</div>
                <div className="spec-val">{vehicle.fuelType || '-'}</div>
             </div>
             <div className="spec-box">
                <div className="spec-label">Colour</div>
                <div className="spec-val">{vehicle.colour}</div>
             </div>
         </div>
         
         <div style={{borderTop: '1px solid var(--border)', paddingTop: '10px'}}>
           <div className="editable-row" style={{cursor:'default'}}>
             <div className="row-label"><StatusDot date={vehicle.motExpiry} /> MOT Expiry</div>
             <div className="row-value">{formatDate(vehicle.motExpiry)}</div>
           </div>
           <EditableDateRow label="Road Tax" value={vehicle.taxExpiry} onChange={(val) => updateDate('taxExpiry', val)} />
           <EditableDateRow label="Insurance" value={vehicle.insuranceExpiry} onChange={(val) => updateDate('insuranceExpiry', val)} />
         </div>

         <div style={{marginTop:'30px'}}>
            <button onClick={onDelete} className="btn btn-danger btn-full btn-sm">Delete Vehicle</button>
         </div>
      </div>

      <div>
        <div className="tabs">
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
                <div className="file-upload-box">
                   <span>{uploading ? "Uploading..." : "Attach Receipt"}</span>
                   <input type="file" name="file" />
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

        {/* --- MOT HISTORY TAB --- */}
        {tab === 'mot' && (
          <div className="fade-in">
             {!vehicle.motTests || vehicle.motTests.length === 0 ? (
               <EmptyState text="No MOT history found." />
             ) : (
               vehicle.motTests.map((test, index) => (
                 <MotTestCard key={index} test={test} />
               ))
             )}
          </div>
        )}

        {tab === 'docs' && (
          <>
            <form onSubmit={e => handleUpload(e, 'doc')} className="bento-card" style={{marginBottom:'24px'}}>
               <h3>Upload Document</h3>
               <div style={{display:'grid', gap:'12px'}}>
                 <input name="name" placeholder="Name (e.g. V5C)" required />
                 <input type="date" name="expiry" />
                 <div className="file-upload-box">
                   <span>{uploading ? "Uploading..." : "Select PDF / Image"}</span>
                   <input type="file" name="file" required />
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

// --- UPDATED MOT CARD (Uses 'defects' array) ---
const MotTestCard = ({ test }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const result = test.testResult || test.status || "UNKNOWN";
  const date = test.completedDate || test.testDate || null;
  const mileage = test.odometerValue ? `${test.odometerValue} ${test.odometerUnit || 'mi'}` : "Unknown Mileage";
  const testNo = test.motTestNumber || "No Ref";
  
  // FIX: Look for 'defects' first, fallback to empty array
  const defects = test.defects || [];
  const hasDetails = defects.length > 0;

  return (
    <div className={`mot-card ${isOpen ? 'mot-expanded' : ''}`} style={{marginBottom: '16px'}}>
      
      {/* HEADER */}
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

      {/* DETAILS PANEL */}
      {isOpen && (
        <div className="mot-details" style={{padding:'20px', borderTop:'1px solid rgba(255,255,255,0.1)'}}>
           {defects.length === 0 ? (
             <p style={{fontStyle:'italic', color:'#64748b', margin:0}}>No advisories or failures recorded for this test.</p>
           ) : (
             <div className="rfr-list">
                {defects.map((item, i) => (
                   <div key={i} className="rfr-item" style={{marginBottom:'10px', display:'flex', gap:'10px', alignItems:'flex-start'}}>
                      {/* TYPE BADGE (FAIL / ADVISORY / MINOR) */}
                      <span className={`rfr-type ${item.type === 'FAIL' || item.type === 'MAJOR' || item.type === 'DANGEROUS' ? 'type-fail' : 'type-advisory'}`}
                            style={{
                              background: (item.type === 'FAIL' || item.type === 'MAJOR' || item.type === 'DANGEROUS') ? '#b91c1c' : '#ca8a04',
                              color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', minWidth:'80px', textAlign:'center', marginTop:'2px'
                            }}>
                        {item.type}
                      </span>
                      {/* THE TEXT */}
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

export default App;