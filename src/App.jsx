import React, { useState, useEffect } from "react";
import { auth, googleProvider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, getDoc, collection, addDoc, onSnapshot, query, orderBy, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import jsPDF from "jspdf";
import "jspdf-autotable";
import "./App.css"; // Import the CSS file

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
    } catch (err) {
      alert("Error: " + err.message);
    }
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
    doc.setTextColor(37, 99, 235);
    doc.text("Vehicle Sale Bundle", 14, 20);
    
    doc.setDrawColor(200);
    doc.setFillColor(245, 245, 245);
    doc.rect(14, 30, 180, 40, "FD");
    
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Registration: ${vehicle.registration}`, 20, 40);
    doc.text(`Make/Model: ${vehicle.make} ${vehicle.model}`, 20, 48);
    doc.text(`Colour: ${vehicle.colour}`, 20, 56);
    doc.text(`MOT Expiry: ${vehicle.motExpiry}`, 100, 40);

    const tableRows = logs.map(l => [
      l.date, 
      l.type, 
      l.desc, 
      `£${l.cost.toFixed(2)}`, 
      l.receipt ? "Link Attached" : "N/A"
    ]);

    doc.autoTable({
      startY: 80,
      head: [['Date', 'Type', 'Description', 'Cost', 'Receipt']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235] }
    });
    doc.save(`${vehicle.registration}_Bundle.pdf`);
  };

  // --- LOGIN SCREEN ---
  if (!user) return (
    <div className="login-container">
      <div className="login-card">
        <h1 style={{color: '#2563eb'}}>🚗 My Garage</h1>
        <p style={{marginBottom: '2rem', color: '#6b7280'}}>Manage your vehicle history, MOT dates, and service logs in one place.</p>
        <button onClick={handleLogin} className="btn btn-primary" style={{width: '100%'}}>
          Sign in with Google
        </button>
      </div>
    </div>
  );

  // --- DASHBOARD ---
  return (
    <div className="container">
      <header className="header">
        <h2>🚗 My Garage</h2>
        <div className="header-actions">
          {vehicle && (
            <button onClick={generateBundle} className="btn btn-success">
              📄 Download Bundle
            </button>
          )}
          <button onClick={() => signOut(auth)} className="btn btn-danger">
            Sign Out
          </button>
        </div>
      </header>

      {/* 1. Vehicle Card */}
      <div className="card">
        <h3>Vehicle Status</h3>
        {vehicle ? (
          <div>
            <div className="status-grid">
              <div>
                <label>Vehicle</label>
                <div className="reg-plate">{vehicle.registration}</div>
                <div style={{fontSize: '1.2rem', marginTop: '5px', fontWeight: '500'}}>
                  {vehicle.make} {vehicle.model}
                </div>
              </div>
              <div style={{textAlign: 'right'}}>
                <label>MOT Expires In</label>
                <div className={`days-badge ${vehicle.daysToMot < 30 ? 'red' : 'green'}`}>
                  {vehicle.daysToMot} Days
                </div>
                <div style={{fontSize: '0.9rem', color: '#6b7280'}}>
                  {vehicle.motExpiry}
                </div>
              </div>
            </div>
            <button onClick={() => setVehicle(null)} className="btn btn-link" style={{marginTop: '15px'}}>
              Switch Vehicle
            </button>
          </div>
        ) : (
          <div className="search-box">
            <input 
              value={regInput} 
              onChange={(e) => setRegInput(e.target.value.toUpperCase())} 
              placeholder="Enter Registration (e.g. AA19AAA)" 
            />
            <button onClick={fetchVehicle} disabled={loading} className="btn btn-primary">
              {loading ? "..." : "Track"}
            </button>
          </div>
        )}
      </div>

      {/* 2. Add Log Form */}
      {vehicle && (
        <div className="card">
          <h3>Add Service/Repair Log</h3>
          <form onSubmit={addLog} className="form-grid">
            <div className="input-group">
              <label>Date</label>
              <input type="date" name="date" required />
            </div>
            <div className="input-group">
              <label>Type</label>
              <select name="type">
                <option>Service</option>
                <option>Repair</option>
                <option>Part Replacement</option>
                <option>Tax/Insurance</option>
                <option>MOT</option>
              </select>
            </div>
            <div className="input-group">
              <label>Cost (£)</label>
              <input type="number" step="0.01" name="cost" placeholder="0.00" />
            </div>
            <div className="input-group full-width">
              <label>Description</label>
              <input name="desc" placeholder="e.g. Full Service & Oil Change" required />
            </div>
            <div className="input-group full-width">
              <label>Receipt (Image/PDF)</label>
              <input type="file" name="file" accept="image/*,application/pdf" />
            </div>
            <button type="submit" disabled={uploading} className="btn btn-primary full-width">
              {uploading ? "Uploading..." : "Save Log Entry"}
            </button>
          </form>
        </div>
      )}

      {/* 3. Logs Table */}
      {vehicle && logs.length > 0 && (
        <div className="card">
          <h3>History Log</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Cost</th>
                  <th>Receipt</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{log.date}</td>
                    <td>{log.type}</td>
                    <td>{log.desc}</td>
                    <td>£{log.cost.toFixed(2)}</td>
                    <td>{log.receipt ? <a href={log.receipt} target="_blank" rel="noreferrer" style={{color: 'var(--primary)'}}>View</a> : '-'}</td>
                    <td style={{textAlign: 'right'}}>
                      <button onClick={() => deleteDoc(doc(db, "users", user.uid, "logs", log.id))} className="btn btn-danger" style={{padding: '5px 10px', fontSize: '0.8rem'}}>
                        X
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;