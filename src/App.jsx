import React, { useState, useEffect } from "react";
import { auth, googleProvider, db, storage } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from "firebase/auth";
import { doc, setDoc, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDFDocument, rgb } from 'pdf-lib'; 
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
  const showToast = React.useContext(ToastContext);

  // Modal State
  const [showAddWizard, setShowAddWizard] = useState(false);

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
      {/* Wizard Modal */}
      {showAddWizard && (
        <AddVehicleWizard 
          user={user} 
          onClose={() => setShowAddWizard(false)} 
          onComplete={() => { setShowAddWizard(false); showToast("Vehicle Added!"); }} 
        />
      )}

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

// --- NEW COMPONENT: ADD VEHICLE WIZARD ---
const AddVehicleWizard = ({ user, onClose, onComplete }) => {
  const [step, setStep] = useState(1); // 1: Input, 2: Fetching/Success, 3: Insurance
  const [reg, setReg] = useState("");
  const [vehicleData, setVehicleData] = useState(null);
  const [error, setError] = useState(null);
  
  // Insurance State
  const [insurer, setInsurer] = useState(null);
  const [insuranceDate, setInsuranceDate] = useState("");
  const [customInsurer, setCustomInsurer] = useState("");

  // REPLACE WITH YOUR KEY
  const LOGO_DEV_PK = "pk_XnIP3CQSQoGp70yuA4nesA"; 

  const commonInsurers = [
    { name: "Admiral", domain: "admiral.com" },
    { name: "Aviva", domain: "aviva.co.uk" },
    { name: "Direct Line", domain: "directline.com" },
    { name: "Hastings", domain: "hastingsdirect.com" },
    { name: "Churchill", domain: "churchill.com" },
    { name: "AXA", domain: "axa.co.uk" },
    { name: "LV", domain: "lv.com" },
    { name: "Tesco Bank", domain: "tescobank.com" },
    { name: "Marshmallow", domain: "marshmallow.com" }
  ];

  const fetchVehicle = async () => {
    if(!reg) return;
    setStep(2); // Show Loading
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
      // Stay on Step 2 (Success animation) for 2 seconds, then move to insurance
      setTimeout(() => setStep(3), 2500);
    } catch (err) {
      setError(err.message);
      setStep(1); // Go back
    }
  };

  const saveVehicle = async () => {
    if(!vehicleData) return;
    
    const finalInsurer = customInsurer || (insurer ? insurer.name : "");
    
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
      
      // Saved from Wizard
      insuranceExpiry: insuranceDate,
      insuranceProvider: finalInsurer,
      
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
                   <div className="check-row">
                      <span>Vehicle Specs (DVLA)</span>
                      <div className="check-icon" style={{animationDelay:'0.5s'}}>✓</div>
                   </div>
                   <div className="check-row">
                      <span>MOT History (DVSA)</span>
                      <div className="check-icon" style={{animationDelay:'1s'}}>✓</div>
                   </div>
                   <div className="check-row">
                      <span>Tax Status</span>
                      <div className="check-icon" style={{animationDelay:'1.5s'}}>✓</div>
                   </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: INSURANCE */}
        {step === 3 && (
          <div className="wizard-step">
             <h2 style={{fontSize:'1.4rem'}}>When is your Insurance due?</h2>
             
             {/* Big Date Picker */}
             <div style={{margin:'20px 0'}}>
                <input 
                  type="date" 
                  style={{fontSize:'1.2rem', padding:'15px', background:'#232730', border:'1px solid var(--primary)', color:'white', width:'100%', textAlign:'center'}} 
                  value={insuranceDate}
                  onChange={e => setInsuranceDate(e.target.value)}
                />
             </div>

             <h3 style={{fontSize:'1.1rem', marginTop:'30px', textAlign:'left'}}>Who are you insured with?</h3>
             <div className="insurer-grid">
                {commonInsurers.map(ins => (
                  <div 
                    key={ins.name} 
                    className={`insurer-option ${insurer === ins ? 'selected' : ''}`}
                    onClick={() => { setInsurer(ins); setCustomInsurer(""); }}
                  >
                    <img src={`https://img.logo.dev/${ins.domain}?token=${LOGO_DEV_PK}&size=100&format=png`} alt={ins.name} className="insurer-logo" />
                  </div>
                ))}
             </div>

             {/* Custom Insurer Input */}
             <div style={{marginTop:'15px'}}>
               <input 
                 placeholder="Or type provider name..." 
                 value={customInsurer}
                 onChange={e => { setCustomInsurer(e.target.value); setInsurer(null); }}
                 style={{background:'#232730', border:'1px solid var(--border)'}}
               />
             </div>

             <button onClick={saveVehicle} className="btn btn-primary btn-full" style={{marginTop:'20px'}}>
               Complete Setup
             </button>
          </div>
        )}
      </div>
    </div>
  );
};

function DashboardView({ user, vehicle, onDelete, showToast }) {
  const [tab, setTab] = useState("logs");
  const [logs, setLogs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // New state for refresh button
  
  // Track selected filenames
  const [logFile, setLogFile] = useState(null);
  const [docFile, setDocFile] = useState(null);

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

  // --- NEW: REFRESH DATA FUNCTION ---
  const refreshData = async () => {
    setRefreshing(true);
    try {
      // 1. Call your API with the existing registration
      const res = await fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: vehicle.registration })
      });
      
      if (!res.ok) throw new Error("Failed to contact server");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // 2. Prepare the updates (Only update fields that come from the API)
      const updates = {
        make: data.make,
        model: data.model,
        colour: data.primaryColour,
        engineSize: data.engineSize,
        fuelType: data.fuelType,
        manufactureDate: data.manufactureDate,
        firstUsedDate: data.firstUsedDate,
        
        // Update Tax & MOT
        taxExpiry: data.taxDueDate || "", 
        motTests: data.motTests || [],
        motExpiry: data.motTests ? data.motTests[0].expiryDate : "",
        
        lastRefreshed: new Date().toISOString()
      };

      // 3. Save to Firestore (Merge)
      await updateDoc(doc(db, "users", user.uid, "vehicles", vehicle.id), updates);
      showToast("Vehicle data refreshed from DVLA/DVSA!");

    } catch (err) {
      console.error(err);
      showToast("Refresh failed: " + err.message, "error");
    }
    setRefreshing(false);
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
      if(type === 'log') setLogFile(null);
      if(type === 'doc') setDocFile(null);

    } catch (err) { showToast(err.message, "error"); }
    setUploading(false);
  };

  const generateSaleBundle = async () => {
    showToast("Generating Bundle... (This may take a moment)", "success");
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      doc.setFontSize(22);
      doc.setTextColor(40, 40, 40);
      doc.text(`Vehicle History Report`, 14, 20);
      
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

      doc.text("Document Inventory", 14, currentY);
      const docRows = docs.map(d => [
        d.name,
        d.expiry ? formatDate(d.expiry) : 'N/A',
        "Attached in Bundle"
      ]);
      autoTable(doc, {
        startY: currentY + 5,
        head: [['Document Name', 'Expiry Date', 'Status']],
        body: docRows,
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] }
      });
      currentY = doc.lastAutoTable.finalY + 15;

      doc.text("Recent MOT History", 14, currentY);
      const motRows = (vehicle.motTests || []).slice(0, 10).map(m => {
        const defects = m.defects || [];
        const defectText = defects.length > 0 
          ? defects.map(d => `• ${d.text} (${d.type})`).join("\n")
          : "No Advisories";

        return [
          formatDate(m.completedDate),
          m.testResult,
          m.odometerValue ? `${m.odometerValue} ${m.odometerUnit}` : "-",
          defectText
        ];
      });

      autoTable(doc, {
        startY: currentY + 5,
        head: [['Date', 'Result', 'Mileage', 'Notes / Defects']],
        body: motRows,
        theme: 'grid',
        headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255] },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 20, fontStyle: 'bold' },
          2: { cellWidth: 25 },
          3: { cellWidth: 'auto', fontSize: 8 }
        }
      });

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
          doc.setFontSize(16);
          doc.setFont("helvetica", "bold");
          doc.text(`Appendix: ${img.name}`, 14, 20);
          
          doc.setFontSize(11);
          doc.setFont("helvetica", "normal");
          if(img.type === 'log') {
             doc.text(`Date: ${formatDate(img.date)}`, 14, 28);
             doc.text(`Description: ${img.desc}`, 14, 34);
             doc.text(`Amount: £${img.cost.toFixed(2)}`, 14, 40);
          } else {
             doc.text(`Expiry Date: ${img.expiry ? formatDate(img.expiry) : 'N/A'}`, 14, 28);
          }

          const imgProps = doc.getImageProperties(imgData);
          const pdfWidth = pageWidth - 40;
          const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
          
          if (pdfHeight > pageHeight - 60) {
             const scale = (pageHeight - 60) / pdfHeight;
             doc.addImage(imgData, 'JPEG', 20, 50, pdfWidth * scale, pdfHeight * scale);
          } else {
             doc.addImage(imgData, 'JPEG', 20, 50, pdfWidth, pdfHeight);
          }
        } catch (e) { console.error("Error embedding image", e); }
      }

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

        } catch (err) {
          console.error("Could not merge PDF:", item.name, err);
          showToast(`Failed to merge ${item.name}`, 'error');
        }
      }

      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${vehicle.registration}_SaleBundle.pdf`;
      link.click();
      showToast("Sale Bundle Downloaded Successfully!");

    } catch (err) {
      console.error("Bundle Error", err);
      showToast("Error generating bundle. Check console.", "error");
    }
  };

  const manufactureYear = vehicle.firstUsedDate ? new Date(vehicle.firstUsedDate).getFullYear() : (vehicle.manufactureDate ? new Date(vehicle.manufactureDate).getFullYear() : 'Unknown');

  return (
    <div className="dashboard-grid fade-in">
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
           <div className="editable-row" style={{cursor:'default'}}>
             <div className="row-label"><StatusDot date={vehicle.motExpiry} /> MOT Expiry</div>
             <div className="row-value">{formatDate(vehicle.motExpiry)}</div>
           </div>
           <EditableDateRow label="Road Tax Expiry" value={vehicle.taxExpiry} onChange={(val) => updateDate('taxExpiry', val)} />
           <EditableDateRow label="Insurance" value={vehicle.insuranceExpiry} onChange={(val) => updateDate('insuranceExpiry', val)} />
         </div>

         {/* ACTIONS */}
         <div style={{marginTop:'30px', display:'flex', flexDirection:'column', gap:'10px'}}>
            
            {/* NEW REFRESH BUTTON */}
            <button onClick={refreshData} disabled={refreshing} className="btn btn-secondary btn-full">
               {refreshing ? <div className="spinner" style={{width:16, height:16, borderTopColor:'#000'}}></div> : "🔄 Refresh Vehicle Data"}
            </button>
            
            <button onClick={generateSaleBundle} className="btn btn-full" 
              style={{background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)', color:'black', border:'none', boxShadow:'0 4px 12px rgba(251, 191, 36, 0.3)'}}>
              📄 Generate Sale Bundle
            </button>
            
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

export default App;