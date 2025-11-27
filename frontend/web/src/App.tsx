import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ModelData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  category: string;
  price: number;
  accuracy: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingModel, setCreatingModel] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newModelData, setNewModelData] = useState({ 
    name: "", 
    value: "", 
    description: "",
    category: "AI",
    price: "0",
    accuracy: "95"
  });
  const [selectedModel, setSelectedModel] = useState<ModelData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, avgPrice: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const modelsList: ModelData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          modelsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            category: "AI",
            price: Number(businessData.publicValue1) || 0,
            accuracy: Number(businessData.publicValue2) || 95
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setModels(modelsList);
      updateStats(modelsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (modelsList: ModelData[]) => {
    const total = modelsList.length;
    const verified = modelsList.filter(m => m.isVerified).length;
    const avgPrice = total > 0 ? modelsList.reduce((sum, m) => sum + m.price, 0) / total : 0;
    setStats({ total, verified, avgPrice });
  };

  const createModel = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingModel(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating model with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const modelValue = parseInt(newModelData.value) || 0;
      const businessId = `model-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, modelValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newModelData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newModelData.price) || 0,
        parseInt(newModelData.accuracy) || 95,
        newModelData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Model created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewModelData({ name: "", value: "", description: "", category: "AI", price: "0", accuracy: "95" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingModel(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is available: ${isAvailable}` 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredModels = models.filter(model => {
    const matchesSearch = model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         model.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || model.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ["all", "AI", "ML", "NLP", "CV", "Audio"];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>ModelMart FHE 🔐</h1>
            <p>AI Model Privacy Marketplace</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🤖</div>
            <h2>Connect Your Wallet to Access Encrypted AI Models</h2>
            <p>Experience secure AI model trading with fully homomorphic encryption technology</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Browse encrypted AI models securely</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Trade models with complete privacy protection</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your AI model transactions</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted marketplace...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>ModelMart FHE 🔐</h1>
          <p>Secure AI Model Marketplace</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + List Model
          </button>
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
            FAQ
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      {showFAQ && (
        <div className="faq-modal">
          <div className="faq-content">
            <h3>FHE AI Marketplace FAQ</h3>
            <div className="faq-item">
              <strong>What is FHE?</strong>
              <p>Fully Homomorphic Encryption allows computation on encrypted data without decryption.</p>
            </div>
            <div className="faq-item">
              <strong>How are models protected?</strong>
              <p>Models and data remain encrypted during inference using Zama FHE technology.</p>
            </div>
            <div className="faq-item">
              <strong>What data types are supported?</strong>
              <p>Currently supports integer values for FHE operations.</p>
            </div>
            <button onClick={() => setShowFAQ(false)} className="close-faq">Close</button>
          </div>
        </div>
      )}
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Models</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-card">
            <h3>Avg Price</h3>
            <div className="stat-value">{stats.avgPrice.toFixed(1)} ETH</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search models..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select 
              value={selectedCategory} 
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat === "all" ? "All Categories" : cat}</option>
              ))}
            </select>
            <button onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="models-grid">
          {filteredModels.length === 0 ? (
            <div className="no-models">
              <p>No AI models found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                List First Model
              </button>
            </div>
          ) : (
            filteredModels.map((model, index) => (
              <div 
                className={`model-card ${model.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedModel(model)}
              >
                <div className="model-header">
                  <h3>{model.name}</h3>
                  <span className="price">{model.price} ETH</span>
                </div>
                <div className="model-meta">
                  <span>Accuracy: {model.accuracy}%</span>
                  <span>Category: {model.category}</span>
                </div>
                <p className="model-desc">{model.description}</p>
                <div className="model-status">
                  {model.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                </div>
                <div className="model-creator">
                  Creator: {model.creator.substring(0, 6)}...{model.creator.substring(38)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateModel 
          onSubmit={createModel} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingModel} 
          modelData={newModelData} 
          setModelData={setNewModelData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedModel && (
        <ModelDetailModal 
          model={selectedModel} 
          onClose={() => setSelectedModel(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedModel.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateModel: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  modelData: any;
  setModelData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, modelData, setModelData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'value' || name === 'price' || name === 'accuracy') {
      const intValue = value.replace(/[^\d]/g, '');
      setModelData({ ...modelData, [name]: intValue });
    } else {
      setModelData({ ...modelData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-model-modal">
        <div className="modal-header">
          <h2>List New AI Model</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Model parameters will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Model Name *</label>
            <input 
              type="text" 
              name="name" 
              value={modelData.name} 
              onChange={handleChange} 
              placeholder="Enter model name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Model Parameter (Integer) *</label>
            <input 
              type="number" 
              name="value" 
              value={modelData.value} 
              onChange={handleChange} 
              placeholder="Enter parameter value..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Price (ETH) *</label>
            <input 
              type="number" 
              name="price" 
              value={modelData.price} 
              onChange={handleChange} 
              placeholder="Enter price in ETH..." 
              min="0"
              step="0.1"
            />
          </div>
          
          <div className="form-group">
            <label>Accuracy (%) *</label>
            <input 
              type="number" 
              name="accuracy" 
              value={modelData.accuracy} 
              onChange={handleChange} 
              placeholder="Enter accuracy percentage..." 
              min="0"
              max="100"
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={modelData.description} 
              onChange={handleChange} 
              placeholder="Describe your AI model..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !modelData.name || !modelData.value} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Listing..." : "List Model"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ModelDetailModal: React.FC<{
  model: ModelData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ model, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const value = await decryptData();
    setDecryptedValue(value);
  };

  return (
    <div className="modal-overlay">
      <div className="model-detail-modal">
        <div className="modal-header">
          <h2>Model Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="model-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{model.name}</strong>
            </div>
            <div className="info-row">
              <span>Price:</span>
              <strong>{model.price} ETH</strong>
            </div>
            <div className="info-row">
              <span>Accuracy:</span>
              <strong>{model.accuracy}%</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{model.creator.substring(0, 6)}...{model.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Listed:</span>
              <strong>{new Date(model.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Model Data</h3>
            
            <div className="data-row">
              <div className="data-label">Model Parameter:</div>
              <div className="data-value">
                {model.isVerified ? 
                  `${model.decryptedValue} (On-chain Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(model.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 model.isVerified ? "✅ Verified" : 
                 decryptedValue !== null ? "🔄 Re-verify" : "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Inference</strong>
                <p>Model parameters remain encrypted during computation using homomorphic encryption.</p>
              </div>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{model.description}</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!model.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;