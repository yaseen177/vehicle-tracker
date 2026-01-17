import React, { useState, useEffect } from "react";
import { auth, googleProvider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, getDoc, collection, addDoc, onSnapshot, query, orderBy, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import jsPDF from "jspdf";
import "jspdf-autotable";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [regInput, setRegInput] = useState("");
  const [vehicle, setVehicle] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) loadData(u.uid);
    });
  }, []);

  const loadData = (uid) => {
    getDoc(doc(db, "users", uid)).then(snap => {
      if (snap.exists()) setVehicle(snap.data());
    });
    const q = query(collection(db, "users", uid, "logs"), orderBy("date", "desc"));
    onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  };

  const handleLogin = () => signInWithPopup(auth, googleProvider);

  const fetchVehicle = async () => {
    if (!regInput) return;
    setLoading(true);
    try {
      const res = await fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: regInput })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.make) throw new Error("Vehicle not found");

      const newVehicle = {
        registration: regInput,
        make: data.make,
        model: data.model,
        colour: data.primaryColour,
        motExpiry: data.motTests ? data.motTests[0].expiryDate : "Unknown",
        daysToMot: data.motTests ? calculateDays(data.motTests[0].expiryDate) : 0
      };
      await setDoc(doc(db, "users", user.uid), newVehicle);
      setVehicle(newVehicle);
    } catch (err) { alert("Error: " + err.message); }
    setLoading(false);
  };

  const calculateDays = (dateStr) => {
    const diff = new Date(dateStr) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const addLog = async (e) => {
    e.preventDefault();
    setUploading(true);
    const form = new FormData(e.target);
    const file = form.get("file");
    
    let fileUrl = "";
    if (file && file.size > 0) {
      const storageRef = ref(storage, `receipts/${user.uid}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      fileUrl = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, "users", user.uid, "logs"), {
      date: form.get("date"),
      type: form.get("type"),
      desc: form.get("desc"),
      cost: parseFloat(form.get("cost") || 0),
      receipt: fileUrl
    });
    e.target.reset();
    setUploading(false);
  };

  const generateBundle = () => {
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text("Vehicle Sale Bundle", 14, 20);
    // ... (Keep existing PDF logic or expand if needed) ...
    const tableRows = logs.map(l => [l.date, l.type, l.desc, `£${l.cost.toFixed(2)}`, l.receipt ? "Link" : "-"]);
    doc.autoTable({ startY: 40, head: [['Date', 'Type', 'Desc', 'Cost', 'Ref']], body: tableRows });
    doc.save(`${vehicle.registration}_Bundle.pdf`);
  };

  // --- LOGIN SCREEN ---
  if (!user) return (
    <div className="search-hero">
      <h1>🚗 My Garage</h1>
      <p style={{marginBottom: '2rem', fontSize: '1.2rem', color: '#666'}}>
        The modern way to track your vehicle history.
      </p>
      <button onClick={handleLogin} className="btn btn-primary" style={{fontSize: '1.2rem', padding: '20px 40px'}}>
        Sign in with Google
      </button>
    </div>
  );

  // --- MAIN APP ---
  return (
    <div className="app-wrapper">
      <header className="top-nav">
        <div className="logo">My Garage</div>
        <div style={{display:'flex', gap:'10px'}}>
          {vehicle && <button onClick={generateBundle} className="btn btn-secondary">Download PDF</button>}
          <button onClick={() => signOut(auth)} className="btn btn-danger">Sign Out</button>
        </div>
      </header>

      {/* SEARCH STATE (If no vehicle selected) */}
      {!vehicle ? (
        <div className="search-hero">
          <h2>Track a Vehicle</h2>
          <input 
            value={regInput} 
            onChange={(e) => setRegInput(e.target.value.toUpperCase())} 
            placeholder="Enter Registration (e.g. AA19 AAA)" 
            style={{fontSize: '1.5rem', textAlign: 'center', letterSpacing: '2px', textTransform: 'uppercase'}}
          />
          <button onClick={fetchVehicle} disabled={loading} className="btn btn-primary" style={{width: '100%', marginTop:'1rem'}}>
            {loading ? "Searching..." : "Track Vehicle"}
          </button>
        </div>
      ) : (
        /* DASHBOARD GRID (Desktop: Sidebar Left, Content Right) */
        <div className="dashboard-grid">
          
          {/* LEFT COLUMN: Vehicle Stats */}
          <div className="bento-card">
             <div className="car-plate">{vehicle.registration}</div>
             <h2 style={{margin:0, fontSize:'1.8rem'}}>{vehicle.make}</h2>
             <div style={{color:'#666', fontSize:'1.2rem'}}>{vehicle.model}</div>
             
             <div className="stat-group">
               <div className="stat-label">MOT Status</div>
               <div className={`stat-value ${vehicle.daysToMot < 30 ? 'red' : 'green'}`}>
                 {vehicle.daysToMot} Days Left
               </div>
               <div style={{color:'#999'}}>Expires: {vehicle.motExpiry}</div>
             </div>

             <div className="stat-group">
               <button onClick={() => setVehicle(null)} className="btn btn-secondary" style={{width:'100%'}}>Switch Vehicle</button>
             </div>
          </div>

          {/* RIGHT COLUMN: Action & History */}
          <div style={{display:'flex', flexDirection:'column', gap:'2rem'}}>
            
            {/* Log Form */}
            <div className="bento-card">
              <h3 style={{marginTop:0}}>Add New Log</h3>
              <form onSubmit={addLog} style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'15px'}}>
                <input type="date" name="date" required />
                <select name="type">
                  <option>Service</option>
                  <option>Repair</option>
                  <option>Part</option>
                  <option>Tax/MOT</option>
                </select>
                <input type="number" step="0.01" name="cost" placeholder="Cost £" />
                <input name="desc" placeholder="Description" required style={{gridColumn: '1 / -1'}} />
                <div style={{gridColumn: '1 / -1', display:'flex', gap:'10px'}}>
                  <input type="file" name="file" />
                  <button type="submit" disabled={uploading} className="btn btn-primary" style={{flex:1}}>
                    {uploading ? "Saving..." : "Add Entry"}
                  </button>
                </div>
              </form>
            </div>

            {/* Logs List */}
            <div className="bento-card" style={{padding:0, overflow:'hidden'}}>
              <div className="log-row log-header" style={{display: window.innerWidth < 640 ? 'none' : 'grid'}}>
                <div>Date</div>
                <div>Type</div>
                <div>Description</div>
                <div>Cost</div>
                <div>Receipt</div>
                <div></div>
              </div>
              {logs.length === 0 ? <div style={{padding:'2rem', textAlign:'center', color:'#999'}}>No history yet.</div> : logs.map(log => (
                <div key={log.id} className="log-row">
                  <div>{log.date}</div>
                  <div style={{fontWeight:'600', fontSize:'0.9rem', background:'#f3f4f6', padding:'4px 8px', borderRadius:'6px', display:'inline-block', textAlign:'center'}}>{log.type}</div>
                  <div className="log-desc">{log.desc}</div>
                  <div style={{fontWeight:'bold'}}>£{log.cost.toFixed(2)}</div>
                  <div>{log.receipt ? <a href={log.receipt} target="_blank" className="btn btn-secondary" style={{padding:'5px 10px', fontSize:'0.8rem'}}>View</a> : '-'}</div>
                  <div style={{textAlign:'right'}}>
                     <button onClick={() => deleteDoc(doc(db, "users", user.uid, "logs", log.id))} className="btn btn-danger">X</button>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default App;