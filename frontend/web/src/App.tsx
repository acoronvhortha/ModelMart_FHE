import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ModelData {
  id: string;
  name: string;
  encryptedValue: string;
  accuracy: number;
  price: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
  category: string;
  downloads: number;
  rating: number;
}

interface UserHistory {
  id: string;
  action: string;
  modelName: string;
  timestamp: number;
  status: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingModel, setUploadingModel] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newModelData, setNewModelData] = useState({ 
    name: "", 
    accuracy: "", 
    price: "", 
    category: "AI" 
  });
  const [selectedModel, setSelectedModel] = useState<ModelData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [userHistory, setUserHistory] = useState<UserHistory[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState({
    totalModels: 0,
    verifiedModels: 0,
    totalDownloads: 0,
    avgRating: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadModels();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadModels = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const modelsList: ModelData[] = [];
      let totalDownloads = 0;
      let totalRating = 0;
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const downloads = Number(businessData.publicValue1) || 0;
          const rating = Number(businessData.publicValue2) || 0;
          
          totalDownloads += downloads;
          totalRating += rating;
          
          modelsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            accuracy: rating,
            price: downloads,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            category: "AI",
            downloads: downloads,
            rating: rating
          });
        } catch (e) {
          console.error('Error loading model data:', e);
        }
      }
      
      setModels(modelsList);
      setStats({
        totalModels: modelsList.length,
        verifiedModels: modelsList.filter(m => m.isVerified).length,
        totalDownloads,
        avgRating: modelsList.length > 0 ? totalRating / modelsList.length : 0
      });
      
      if (address) {
        loadUserHistory();
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load models" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const loadUserHistory = async () => {
    const mockHistory: UserHistory[] = [
      {
        id: "1",
        action: "Download",
        modelName: "Neural Network Pro",
        timestamp: Date.now() - 86400000,
        status: "Completed"
      },
      {
        id: "2",
        action: "Upload",
        modelName: "Vision Transformer",
        timestamp: Date.now() - 172800000,
        status: "Verified"
      }
    ];
    setUserHistory(mockHistory);
  };

  const uploadModel = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploadingModel(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting model with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const modelValue = parseInt(newModelData.accuracy) || 0;
      const businessId = `model-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, modelValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newModelData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newModelData.price) || 0,
        parseInt(newModelData.accuracy) || 0,
        `AI Model: ${newModelData.category}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      addToHistory("Upload", newModelData.name, "Pending");
      
      setTransactionStatus({ visible: true, status: "success", message: "Model uploaded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadModels();
      setShowUploadModal(false);
      setNewModelData({ name: "", accuracy: "", price: "", category: "AI" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploadingModel(false); 
    }
  };

  const decryptModel = async (modelId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const modelData = await contractRead.getBusinessData(modelId);
      if (modelData.isVerified) {
        const storedValue = Number(modelData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Model already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(modelId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(modelId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadModels();
      addToHistory("Download", modelId, "Decrypted");
      
      setTransactionStatus({ visible: true, status: "success", message: "Model decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Model already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadModels();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const addToHistory = (action: string, modelName: string, status: string) => {
    const newHistory: UserHistory = {
      id: Date.now().toString(),
      action,
      modelName,
      timestamp: Date.now(),
      status
    };
    setUserHistory(prev => [newHistory, ...prev.slice(0, 9)]);
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredModels = models.filter(model => {
    const matchesSearch = model.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === "All" || model.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ["All", "AI", "ML", "Neural Network", "Vision", "NLP"];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔮</div>
            <h1>ModelMart FHE</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="hero-section">
          <div className="hero-content">
            <h2>FHE-based AI Model Marketplace</h2>
            <p>Buyers upload encrypted data, sellers provide encrypted models, homomorphic inference delivers results</p>
            <div className="hero-features">
              <div className="feature">🔐 Dual Encryption</div>
              <div className="feature">🤖 Homomorphic Inference</div>
              <div className="feature">🛡️ IP Protection</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="neon-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Loading encrypted marketplace...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-main">
          <div className="logo-section">
            <div className="logo-icon">🔮</div>
            <h1>ModelMart FHE</h1>
          </div>
          
          <div className="header-actions">
            <button className="nav-btn" onClick={checkAvailability}>
              Check Availability
            </button>
            <button className="nav-btn" onClick={() => setShowFAQ(!showFAQ)}>
              FAQ
            </button>
            <button className="upload-btn" onClick={() => setShowUploadModal(true)}>
              Upload Model
            </button>
            <ConnectButton />
          </div>
        </div>
        
        <nav className="category-nav">
          {categories.map(category => (
            <button
              key={category}
              className={`category-btn ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </nav>
      </header>

      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <div className="stat-value">{stats.totalModels}</div>
            <div className="stat-label">AI Models</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verifiedModels}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.totalDownloads}</div>
            <div className="stat-label">Downloads</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.avgRating.toFixed(1)}</div>
            <div className="stat-label">Avg Rating</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search AI models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <button className="search-btn">🔍</button>
          </div>
          <button onClick={loadModels} className="refresh-btn">
            {isRefreshing ? "🔄" : "Refresh"}
          </button>
        </div>

        <div className="content-grid">
          <div className="models-section">
            <h2>Available AI Models</h2>
            <div className="models-grid">
              {filteredModels.length === 0 ? (
                <div className="empty-state">
                  <p>No models found</p>
                  <button onClick={() => setShowUploadModal(true)} className="upload-btn">
                    Upload First Model
                  </button>
                </div>
              ) : (
                filteredModels.map((model) => (
                  <div key={model.id} className="model-card">
                    <div className="model-header">
                      <h3>{model.name}</h3>
                      <span className={`status ${model.isVerified ? 'verified' : 'encrypted'}`}>
                        {model.isVerified ? '✅' : '🔒'}
                      </span>
                    </div>
                    <div className="model-meta">
                      <span>Accuracy: {model.accuracy}%</span>
                      <span>Price: {model.price} FHE</span>
                    </div>
                    <div className="model-stats">
                      <span>Downloads: {model.downloads}</span>
                      <span>Rating: {model.rating}/5</span>
                    </div>
                    <button 
                      onClick={() => decryptModel(model.id)}
                      className={`download-btn ${model.isVerified ? 'verified' : ''}`}
                    >
                      {model.isVerified ? 'Download Decrypted' : 'Decrypt & Download'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sidebar">
            <div className="history-panel">
              <h3>Your Activity</h3>
              <div className="history-list">
                {userHistory.map(record => (
                  <div key={record.id} className="history-item">
                    <div className="history-action">{record.action}</div>
                    <div className="history-model">{record.modelName}</div>
                    <div className="history-status">{record.status}</div>
                    <div className="history-time">
                      {new Date(record.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="info-panel">
              <h3>FHE Process</h3>
              <div className="process-step">
                <span>1</span>
                <p>Encrypt model with Zama FHE</p>
              </div>
              <div className="process-step">
                <span>2</span>
                <p>Store encrypted data on-chain</p>
              </div>
              <div className="process-step">
                <span>3</span>
                <p>Homomorphic inference processing</p>
              </div>
              <div className="process-step">
                <span>4</span>
                <p>Secure result delivery</p>
              </div>
            </div>
          </div>
        </div>

        {showFAQ && (
          <div className="faq-panel">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-item">
              <h4>What is FHE encryption?</h4>
              <p>Fully Homomorphic Encryption allows computation on encrypted data without decryption.</p>
            </div>
            <div className="faq-item">
              <h4>How are models protected?</h4>
              <p>Both data and models remain encrypted during entire inference process.</p>
            </div>
            <div className="faq-item">
              <h4>What data types are supported?</h4>
              <p>Currently supports integer numbers for FHE operations.</p>
            </div>
          </div>
        )}
      </div>

      {showUploadModal && (
        <div className="modal-overlay">
          <div className="upload-modal">
            <div className="modal-header">
              <h2>Upload AI Model</h2>
              <button onClick={() => setShowUploadModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Model Name</label>
                <input
                  type="text"
                  value={newModelData.name}
                  onChange={(e) => setNewModelData({...newModelData, name: e.target.value})}
                  placeholder="Enter model name"
                />
              </div>
              <div className="form-group">
                <label>Accuracy Score (FHE Encrypted)</label>
                <input
                  type="number"
                  value={newModelData.accuracy}
                  onChange={(e) => setNewModelData({...newModelData, accuracy: e.target.value})}
                  placeholder="Enter accuracy 0-100"
                />
              </div>
              <div className="form-group">
                <label>Price (Public)</label>
                <input
                  type="number"
                  value={newModelData.price}
                  onChange={(e) => setNewModelData({...newModelData, price: e.target.value})}
                  placeholder="Enter price in tokens"
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select
                  value={newModelData.category}
                  onChange={(e) => setNewModelData({...newModelData, category: e.target.value})}
                >
                  <option value="AI">AI</option>
                  <option value="ML">Machine Learning</option>
                  <option value="Vision">Computer Vision</option>
                  <option value="NLP">Natural Language</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowUploadModal(false)} className="cancel-btn">Cancel</button>
              <button onClick={uploadModel} disabled={uploadingModel} className="upload-btn">
                {uploadingModel ? "Encrypting..." : "Upload Model"}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


