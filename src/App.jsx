import React, { useState, useEffect } from "react";
import { auth, googleProvider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from "firebase/auth";
import { doc, setDoc, getDoc, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import jsPDF from "jspdf";
import "jspdf-autotable";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("garage");
  const [myVehicles, setMyVehicles] = useState([]);
  const [activeVehicleId, setActiveVehicleId] = useState(null); // CHANGED: Store ID, not object
  const [regInput, setRegInput] = useState("");
  const [loading, setLoading] = useState(false);

  // --- AUTH & LOAD GARAGE ---
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) loadGarage(u.uid);
    });
  }, []);

  const loadGarage = (uid) => {
    const q = collection(db, "users", uid, "vehicles");
    onSnapshot(q, (snapshot) => {
      const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMyVehicles(cars);
    });
  };

  // --- DYNAMICALLY FIND THE ACTIVE CAR ---
  // This ensures the dashboard always shows the LIVE data from the database
  const activeVehicle = myVehicles.find(v => v.id === activeVehicleId);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); }
  };

  const addNewVehicle = async () => {
    if (!regInput) return;
    setLoading(true);
    try {
      const res = await fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: regInput })
      });
      
      if (res.status === 404) throw new Error("Vehicle not found.");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const newCar = {
        registration: data.registration || regInput,
        make: data.make,
        model: data.model,
        colour: data.primaryColour,
        motExpiry: data.motTests ? data.motTests[0].expiryDate : "",
        taxExpiry: "",
        insuranceExpiry: "",
        addedAt: new Date().toISOString()
      };

      await setDoc(doc(db, "users", user.uid, "vehicles", newCar.registration), newCar);
      setRegInput("");
      setLoading(false);
      alert("Vehicle Added!");
    } catch (err) {
      alert("Error: " + err.message);
      setLoading(false);
    }
  };

  const deleteVehicle = async (vehicleId) => {
    if (window.confirm("Permanently delete this vehicle?")) {
      await deleteDoc(doc(db, "users", user.uid, "vehicles", vehicleId));
      if (activeVehicleId === vehicleId) {
        setView("garage");
        setActiveVehicleId(null);
      }
    }
  };

  const openDashboard = (car) => {
    setActiveVehicleId(car.id); // CHANGED: Set ID only
    setView("dashboard");
  };

  // --- RENDER ---
  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="app-wrapper">
      <header className="top-nav">
        <div className="logo" onClick={() => setView("garage")} style={{cursor: 'pointer'}}>
          My Garage {view === 'dashboard' && activeVehicle && <span style={{color:'#666', fontSize:'0.8em'}}> / {activeVehicle.registration}</span>}
        </div>
        <div style={{display:'flex', gap:'10px'}}>
          {view === 'dashboard' && <button onClick={() => setView("garage")} className="btn btn-secondary">Back to Garage</button>}
          <button onClick={() => signOut(auth)} className="btn btn-danger">Sign Out</button>
        </div>
      </header>

      {view === 'garage' && (
        <GarageView 
          vehicles={myVehicles} 
          onOpen={openDashboard} 
          regInput={regInput} 
          setRegInput={setRegInput} 
          onAdd={addNewVehicle} 
          loading={loading}
        />
      )}

      {/* Pass the LIVE 'activeVehicle' object derived from state */}
      {view === 'dashboard' && activeVehicle && (
        <DashboardView 
          user={user} 
          vehicle={activeVehicle} 
          onDelete={() => deleteVehicle(activeVehicle.id)}
        />
      )}
    </div>
  );
}

// --- HELPER: UK DATE FORMATTER (DD/MM/YYYY) ---
const formatDate = (dateStr) => {
  if (!dateStr) return "Not Set";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB'); 
};

const calculateDays = (dateStr) => {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

function LoginScreen({ onLogin }) {
  return (
    <div className="search-hero">
      <h1>🚗 My Garage</h1>
      <p style={{marginBottom: '2rem', fontSize: '1.2rem', color: '#666'}}>
        Track Tax, MOT, Insurance and Service History.
      </p>
      <button onClick={onLogin} className="btn btn-primary" style={{fontSize: '1.2rem', padding: '20px 40px'}}>
        Sign in with Google
      </button>
    </div>
  );
}

function GarageView({ vehicles, onOpen, regInput, setRegInput, onAdd, loading }) {
  return (
    <div className="garage-container">
      <div className="bento-card" style={{textAlign:'center', marginBottom: '2rem'}}>
        <h2>Add a Vehicle</h2>
        <div style={{display:'flex', gap:'10px', maxWidth:'500px', margin:'0 auto'}}>
          <input 
            value={regInput} 
            onChange={(e) => setRegInput(e.target.value.toUpperCase())} 
            placeholder="ENTER REG" 
            style={{fontSize:'1.2rem', textAlign:'center', textTransform:'uppercase'}}
          />
          <button onClick={onAdd} disabled={loading} className="btn btn-primary">
            {loading ? "Finding..." : "Add"}
          </button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px'}}>
        {vehicles.map(car => {
          const days = calculateDays(car.motExpiry);
          return (
            <div key={car.id} className="bento-card" style={{cursor: 'pointer', border: '1px solid #e5e7eb'}} onClick={() => onOpen(car)}>
              <div className="car-plate" style={{fontSize: '1.2rem'}}>{car.registration}</div>
              <h3 style={{margin:'10px 0 5px 0'}}>{car.make} {car.model}</h3>
              <div style={{marginTop:'15px', color: days && days < 30 ? 'red' : 'green', fontWeight:'bold'}}>
                 MOT: {days !== null ? `${days} Days Left` : 'Unknown'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardView({ user, vehicle, onDelete }) {
  const [tab, setTab] = useState("logs");
  const [logs, setLogs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const logQ = query(collection(db, "users", user.uid, "vehicles", vehicle.id, "logs"), orderBy("date", "desc"));
    const unsubLogs = onSnapshot(logQ, (snap) => setLogs(snap.docs.map(d => ({id:d.id, ...d.data()}))));

    const docQ = collection(db, "users", user.uid, "vehicles", vehicle.id, "documents");
    const unsubDocs = onSnapshot(docQ, (snap) => setDocs(snap.docs.map(d => ({id:d.id, ...d.data()}))));

    return () => { unsubLogs(); unsubDocs(); };
  }, [vehicle.id]);

  // --- FIX: Update Date Function ---
  const updateDate = async (field, value) => {
    try {
      // 1. Update Firestore
      await updateDoc(doc(db, "users", user.uid, "vehicles", vehicle.id), {
        [field]: value
      });
      // Note: We don't need to manually update local state here because 
      // the 'loadGarage' listener in App.jsx will detect the change 
      // and update the 'activeVehicle' prop automatically!
    } catch (err) {
      console.error("Failed to update date", err);
      alert("Failed to save date");
    }
  };

  // Updated: Adds Try/Catch to show errors
  const handleAddLog = async (e) => {
    e.preventDefault();
    setUploading(true);
    
    try {
      const form = new FormData(e.target);
      const file = form.get("file");
      let fileUrl = "";

      if (file && file.size > 0) {
        // Create reference
        const storageRef = ref(storage, `receipts/${user.uid}/${vehicle.id}/${Date.now()}_${file.name}`);
        // Upload
        await uploadBytes(storageRef, file);
        // Get URL
        fileUrl = await getDownloadURL(storageRef);
      }

      // Save to Database
      await addDoc(collection(db, "users", user.uid, "vehicles", vehicle.id, "logs"), {
        date: form.get("date"),
        type: form.get("type"),
        desc: form.get("desc"),
        cost: parseFloat(form.get("cost") || 0),
        receipt: fileUrl
      });

      e.target.reset(); // Clear form
    } catch (error) {
      console.error("Upload Error:", error);
      alert("Error uploading: " + error.message);
    }
    
    setUploading(false);
  };

  // Updated: Adds Try/Catch to show errors
  const handleAddDoc = async (e) => {
    e.preventDefault();
    setUploading(true);

    try {
      const form = new FormData(e.target);
      const file = form.get("file");

      if (!file || file.size === 0) {
        alert("Please select a file first.");
        setUploading(false);
        return;
      }

      const storageRef = ref(storage, `documents/${user.uid}/${vehicle.id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const fileUrl = await getDownloadURL(storageRef);

      await addDoc(collection(db, "users", user.uid, "vehicles", vehicle.id, "documents"), {
        name: form.get("name"),
        expiry: form.get("expiry"),
        url: fileUrl,
        uploadedAt: new Date().toISOString()
      });

      e.target.reset();
    } catch (error) {
      console.error("Upload Error:", error);
      alert("Error uploading: " + error.message);
    }

    setUploading(false);
  };

  const deleteItem = async (col, id) => {
    if(confirm("Delete this entry?")) await deleteDoc(doc(db, "users", user.uid, "vehicles", vehicle.id, col, id));
  };

  const getStatusColor = (dateStr) => {
    const days = calculateDays(dateStr);
    if (!days) return '#666'; 
    if (days < 0) return 'red'; 
    if (days < 30) return 'orange'; 
    return 'green'; 
  };

  return (
    <div className="dashboard-grid">
      <div className="bento-card">
         <div className="car-plate">{vehicle.registration}</div>
         <h2 style={{margin:0}}>{vehicle.make}</h2>
         <p style={{marginTop:0}}>{vehicle.model}</p>
         <hr style={{borderColor:'#eee'}}/>

         <div className="stat-group">
            <div className="stat-label">MOT Expiry</div>
            <div className="stat-value" style={{color: getStatusColor(vehicle.motExpiry)}}>
              {formatDate(vehicle.motExpiry)}
            </div>
         </div>

         {/* --- TAX INPUT --- */}
         <div className="stat-group">
            <div className="stat-label">Road Tax Expiry</div>
            <input 
              type="date" 
              // value must match YYYY-MM-DD for the input to show it
              value={vehicle.taxExpiry || ""} 
              onChange={(e) => updateDate('taxExpiry', e.target.value)}
              style={{marginBottom:'5px'}}
            />
            {/* We show the prettified DD/MM/YYYY below the input */}
            <div className="stat-value" style={{fontSize:'1rem', color: getStatusColor(vehicle.taxExpiry)}}>
              {vehicle.taxExpiry ? formatDate(vehicle.taxExpiry) : "Set Date 👆"}
            </div>
         </div>

         {/* --- INSURANCE INPUT --- */}
         <div className="stat-group">
            <div className="stat-label">Insurance Expiry</div>
            <input 
              type="date" 
              value={vehicle.insuranceExpiry || ""} 
              onChange={(e) => updateDate('insuranceExpiry', e.target.value)}
              style={{marginBottom:'5px'}}
            />
            <div className="stat-value" style={{fontSize:'1rem', color: getStatusColor(vehicle.insuranceExpiry)}}>
              {vehicle.insuranceExpiry ? formatDate(vehicle.insuranceExpiry) : "Set Date 👆"}
            </div>
         </div>

         <div style={{marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #eee'}}>
           <button onClick={onDelete} className="btn btn-danger" style={{width: '100%'}}>Delete Vehicle</button>
         </div>
      </div>

      <div>
        <div style={{display:'flex', gap:'10px', marginBottom:'20px'}}>
          <button onClick={() => setTab("logs")} className={`btn ${tab==='logs' ? 'btn-primary' : 'btn-secondary'}`}>Service History</button>
          <button onClick={() => setTab("docs")} className={`btn ${tab==='docs' ? 'btn-primary' : 'btn-secondary'}`}>Important Docs</button>
        </div>

        {tab === 'logs' && (
          <>
            <div className="bento-card">
              <h3>Add Log</h3>
              <form onSubmit={handleAddLog} style={{display:'grid', gap:'10px', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))'}}>
                <input type="date" name="date" required />
                <select name="type"><option>Service</option><option>Repair</option><option>MOT</option></select>
                <input type="number" step="0.01" name="cost" placeholder="£ Cost" />
                <input name="desc" placeholder="Description" style={{gridColumn:'1/-1'}} required />
                <input type="file" name="file" style={{gridColumn:'1/-1'}} />
                <button disabled={uploading} className="btn btn-primary" style={{gridColumn:'1/-1'}}>
                  {uploading ? "Saving..." : "Add Log"}
                </button>
              </form>
            </div>
            <div className="bento-card" style={{marginTop:'20px'}}>
              {logs.map(log => (
                <div key={log.id} className="log-row">
                   <div style={{fontWeight:'bold'}}>{formatDate(log.date)}</div>
                   <div>{log.type}</div>
                   <div>{log.desc}</div>
                   <div>£{log.cost}</div>
                   <div>{log.receipt && <a href={log.receipt} target="_blank" style={{color:'blue'}}>View</a>}</div>
                   <button onClick={() => deleteItem('logs', log.id)} className="btn-danger">X</button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'docs' && (
          <>
            <div className="bento-card">
              <h3>Upload Document</h3>
              <form onSubmit={handleAddDoc} style={{display:'grid', gap:'10px'}}>
                <input name="name" placeholder="Doc Name (e.g. V5C)" required />
                <label style={{fontSize:'0.8em'}}>Expiry Date (Optional):</label>
                <input type="date" name="expiry" />
                <input type="file" name="file" required />
                <button disabled={uploading} className="btn btn-primary">
                   {uploading ? "Uploading..." : "Save Document"}
                </button>
              </form>
            </div>
            <div className="bento-card" style={{marginTop:'20px'}}>
              {docs.map(doc => (
                <div key={doc.id} className="log-row" style={{gridTemplateColumns: '1fr 1fr 1fr 50px'}}>
                   <div style={{fontWeight:'bold'}}>{doc.name}</div>
                   <div>{doc.expiry ? `Exp: ${formatDate(doc.expiry)}` : 'No Expiry'}</div>
                   <a href={doc.url} target="_blank" className="btn btn-secondary" style={{textAlign:'center'}}>Download</a>
                   <button onClick={() => deleteItem('documents', doc.id)} className="btn-danger">X</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;