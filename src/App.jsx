import React, { useState, useEffect } from "react";
import { auth, googleProvider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, getDoc, collection, addDoc, onSnapshot, query, orderBy, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import jsPDF from "jspdf";
import "jspdf-autotable";

// --- STYLES (Simple CSS for single-file portability) ---
const styles = {
  container: { fontFamily: "'Segoe UI', sans-serif", maxWidth: "900px", margin: "0 auto", padding: "20px", color: "#333" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #333", paddingBottom: "10px", marginBottom: "20px" },
  card: { background: "#fff", border: "1px solid #ddd", borderRadius: "8px", padding: "20px", marginBottom: "20px", boxShadow: "0 2px 5px rgba(0,0,0,0.05)" },
  btn: { background: "#0056b3", color: "#fff", border: "none", padding: "10px 15px", borderRadius: "5px", cursor: "pointer", fontSize: "14px" },
  btnRed: { background: "#d9534f", color: "#fff", border: "none", padding: "5px 10px", borderRadius: "5px", cursor: "pointer" },
  input: { padding: "10px", border: "1px solid #ccc", borderRadius: "5px", marginRight: "10px", width: "100%", boxSizing: "border-box" },
  table: { width: "100%", borderCollapse: "collapse", marginTop: "10px" },
  th: { textAlign: "left", borderBottom: "2px solid #eee", padding: "10px" },
  td: { borderBottom: "1px solid #eee", padding: "10px" },
  label: { display: "block", marginBottom: "5px", fontWeight: "bold", fontSize: "12px", textTransform: "uppercase", color: "#666" }
};

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
    // 1. Load Vehicle Profile
    getDoc(doc(db, "users", uid)).then(snap => {
      if (snap.exists()) setVehicle(snap.data());
    });
    // 2. Load Logs
    const q = query(collection(db, "users", uid, "logs"), orderBy("date", "desc"));
    onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  };

  const handleLogin = () => signInWithPopup(auth, googleProvider);

  // --- API CALL TO CLOUDFLARE FUNCTION ---
  const fetchVehicle = async () => {
    if (!regInput) return;
    setLoading(true);
    try {
      // Calls local /api/vehicle during dev, or yoursite.com/api/vehicle in prod
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

      // Save to Firestore
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
    
    // Title
    doc.setFontSize(22);
    doc.setTextColor(0, 86, 179);
    doc.text("Vehicle Sale Bundle", 14, 20);
    
    // Vehicle Info Box
    doc.setDrawColor(200);
    doc.setFillColor(245, 245, 245);
    doc.rect(14, 30, 180, 40, "FD");
    
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Registration: ${vehicle.registration}`, 20, 40);
    doc.text(`Make/Model: ${vehicle.make} ${vehicle.model}`, 20, 48);
    doc.text(`Colour: ${vehicle.colour}`, 20, 56);
    doc.text(`MOT Expiry: ${vehicle.motExpiry}`, 100, 40);

    // Table
    const tableRows = logs.map(l => [
      l.date, 
      l.type, 
      l.desc, 
      `£${l.cost.toFixed(2)}`, 
      l.receipt ? "Attached in Drive" : "N/A"
    ]);

    doc.autoTable({
      startY: 80,
      head: [['Date', 'Type', 'Description', 'Cost', 'Receipt']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [0, 86, 179] }
    });

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.text(`Generated by MOT Tracker - Page ${i}`, 14, 290);
    }

    doc.save(`${vehicle.registration}_Bundle.pdf`);
  };

  if (!user) return (
    <div style={{display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', fontFamily: 'sans-serif'}}>
      <h1>Vehicle Management Portal</h1>
      <button onClick={handleLogin} style={styles.btn}>Sign in with Google</button>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2>🚗 My Garage</h2>
        <div style={{display:'flex', gap:'10px'}}>
          {vehicle && <button onClick={generateBundle} style={{...styles.btn, background: 'green'}}>📄 Download Bundle PDF</button>}
          <button onClick={() => signOut(auth)} style={styles.btnRed}>Sign Out</button>
        </div>
      </div>

      {/* 1. Vehicle Card */}
      <div style={styles.card}>
        <h3>Vehicle Status</h3>
        {vehicle ? (
          <div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px'}}>
              <div>
                <span style={styles.label}>Vehicle</span>
                <div style={{fontSize:'24px', fontWeight:'bold'}}>{vehicle.registration}</div>
                <div>{vehicle.make} {vehicle.model}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <span style={styles.label}>MOT Status</span>
                <div style={{fontSize:'24px', color: vehicle.daysToMot < 30 ? 'red' : 'green', fontWeight:'bold'}}>
                  {vehicle.daysToMot} Days
                </div>
                <div>Expires: {vehicle.motExpiry}</div>
              </div>
            </div>
            <button onClick={() => setVehicle(null)} style={{marginTop:'15px', textDecoration:'underline', background:'none', border:'none', color:'blue', cursor:'pointer'}}>Switch Vehicle</button>
          </div>
        ) : (
          <div style={{display:'flex', gap:'10px'}}>
            <input 
              style={styles.input} 
              value={regInput} 
              onChange={(e) => setRegInput(e.target.value.toUpperCase())} 
              placeholder="Enter Registration (e.g., AA19 AAA)" 
            />
            <button onClick={fetchVehicle} disabled={loading} style={styles.btn}>
              {loading ? "Loading..." : "Track Vehicle"}
            </button>
          </div>
        )}
      </div>

      {/* 2. Add Log Form */}
      {vehicle && (
        <div style={styles.card}>
          <h3>Add Service/Repair Log</h3>
          <form onSubmit={addLog} style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px'}}>
            <div>
              <span style={styles.label}>Date</span>
              <input type="date" name="date" required style={styles.input} />
            </div>
            <div>
              <span style={styles.label}>Type</span>
              <select name="type" style={styles.input}>
                <option>Service</option>
                <option>Repair</option>
                <option>Part Replacement</option>
                <option>Tax/Insurance</option>
              </select>
            </div>
            <div>
              <span style={styles.label}>Cost (£)</span>
              <input type="number" step="0.01" name="cost" style={styles.input} />
            </div>
            <div style={{gridColumn: '1 / span 2'}}>
              <span style={styles.label}>Description</span>
              <input name="desc" placeholder="e.g. Full Service & Oil Change" required style={styles.input} />
            </div>
            <div>
              <span style={styles.label}>Receipt (Img/PDF)</span>
              <input type="file" name="file" style={styles.input} />
            </div>
            <button type="submit" disabled={uploading} style={{...styles.btn, gridColumn: '1 / span 3', marginTop:'10px'}}>
              {uploading ? "Uploading..." : "Save Log Entry"}
            </button>
          </form>
        </div>
      )}

      {/* 3. Logs Table */}
      {vehicle && logs.length > 0 && (
        <div style={styles.card}>
          <h3>History Log</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Cost</th>
                <th style={styles.th}>Receipt</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td style={styles.td}>{log.date}</td>
                  <td style={styles.td}>{log.type}</td>
                  <td style={styles.td}>{log.desc}</td>
                  <td style={styles.td}>£{log.cost.toFixed(2)}</td>
                  <td style={styles.td}>{log.receipt ? <a href={log.receipt} target="_blank" style={{color:'blue'}}>View</a> : '-'}</td>
                  <td style={styles.td}>
                    <button onClick={() => deleteDoc(doc(db, "users", user.uid, "logs", log.id))} style={styles.btnRed}>X</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;