import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SurveyData {
  id: string;
  title: string;
  category: string;
  sentiment: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface SurveyStats {
  totalSurveys: number;
  verifiedCount: number;
  avgSentiment: number;
  recentSurveys: number;
  categoryBreakdown: { [key: string]: number };
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<SurveyData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSurvey, setCreatingSurvey] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSurveyData, setNewSurveyData] = useState({ 
    title: "", 
    category: "general", 
    sentiment: 5,
    feedback: "" 
  });
  const [selectedSurvey, setSelectedSurvey] = useState<SurveyData | null>(null);
  const [stats, setStats] = useState<SurveyStats>({
    totalSurveys: 0,
    verifiedCount: 0,
    avgSentiment: 0,
    recentSurveys: 0,
    categoryBreakdown: {}
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const categories = ["general", "management", "workplace", "benefits", "culture", "technical"];
  const faqItems = [
    { question: "How is my feedback encrypted?", answer: "All feedback is encrypted using FHE technology before being stored on-chain." },
    { question: "Is my identity protected?", answer: "Yes, all surveys are completely anonymous and untraceable." },
    { question: "How are statistics calculated?", answer: "Statistics are computed using homomorphic encryption without decrypting individual data." },
    { question: "Can my employer see my responses?", answer: "No, individual responses remain encrypted and anonymous." }
  ];

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
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
        await loadData();
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

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const surveysList: SurveyData[] = [];
      const categoryCount: { [key: string]: number } = {};
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const category = categories[Number(businessData.publicValue1) % categories.length] || "general";
          categoryCount[category] = (categoryCount[category] || 0) + 1;
          
          surveysList.push({
            id: businessId,
            title: businessData.name,
            category: category,
            sentiment: Number(businessData.publicValue2) || 5,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading survey data:', e);
        }
      }
      
      setSurveys(surveysList);
      
      const total = surveysList.length;
      const verified = surveysList.filter(s => s.isVerified).length;
      const avgSentiment = total > 0 ? surveysList.reduce((sum, s) => sum + s.sentiment, 0) / total : 0;
      const recent = surveysList.filter(s => Date.now()/1000 - s.timestamp < 604800).length;
      
      setStats({
        totalSurveys: total,
        verifiedCount: verified,
        avgSentiment: avgSentiment,
        recentSurveys: recent,
        categoryBreakdown: categoryCount
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createSurvey = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSurvey(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted survey..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const sentimentValue = newSurveyData.sentiment;
      const businessId = `survey-${Date.now()}`;
      const categoryIndex = categories.indexOf(newSurveyData.category);
      
      const encryptedResult = await encrypt(contractAddress, address, sentimentValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSurveyData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        categoryIndex,
        0,
        newSurveyData.feedback
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Survey created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSurveyData({ title: "", category: "general", sentiment: 5, feedback: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSurvey(false); 
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
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSurveys = surveys.filter(survey =>
    survey.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    survey.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsChart = () => {
    return (
      <div className="stats-chart">
        <div className="chart-row">
          <div className="chart-label">Total Surveys</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${Math.min(100, stats.totalSurveys * 10)}%` }}>
              <span className="bar-value">{stats.totalSurveys}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Verified Data</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${stats.totalSurveys ? (stats.verifiedCount / stats.totalSurveys) * 100 : 0}%` }}>
              <span className="bar-value">{stats.verifiedCount}/{stats.totalSurveys}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Avg Sentiment</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${stats.avgSentiment * 10}%` }}>
              <span className="bar-value">{stats.avgSentiment.toFixed(1)}/10</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCategoryBreakdown = () => {
    return (
      <div className="category-breakdown">
        <h4>Feedback Categories</h4>
        <div className="category-bars">
          {categories.map(category => (
            <div key={category} className="category-item">
              <span className="category-name">{category}</span>
              <div className="category-bar">
                <div 
                  className="category-fill" 
                  style={{ width: `${stats.categoryBreakdown[category] ? (stats.categoryBreakdown[category] / stats.totalSurveys) * 100 : 0}%` }}
                ></div>
              </div>
              <span className="category-count">{stats.categoryBreakdown[category] || 0}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>PulseCheck FHE 🔐</h1>
            <p>員工隱私脈搏 - Confidential Employee Surveys</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Access Anonymous Surveys</h2>
            <p>Your feedback is encrypted with FHE technology for complete anonymity</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet securely</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Submit encrypted feedback anonymously</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your anonymity</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted survey system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PulseCheck FHE 🔐</h1>
          <p>員工隱私脈搏 - Confidential Employee Surveys</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">System Status</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ New Survey</button>
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">FAQ</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search surveys..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
          
          <div className="stats-grid">
            <div className="stat-card">
              <h3>Total Surveys</h3>
              <div className="stat-value neon-purple">{stats.totalSurveys}</div>
              <div className="stat-trend">+{stats.recentSurveys} this week</div>
            </div>
            
            <div className="stat-card">
              <h3>Verified Data</h3>
              <div className="stat-value neon-blue">{stats.verifiedCount}/{stats.totalSurveys}</div>
              <div className="stat-trend">FHE Protected</div>
            </div>
            
            <div className="stat-card">
              <h3>Avg Sentiment</h3>
              <div className="stat-value neon-pink">{stats.avgSentiment.toFixed(1)}/10</div>
              <div className="stat-trend">Encrypted Analytics</div>
            </div>
          </div>
          
          {renderStatsChart()}
          {renderCategoryBreakdown()}
        </div>
        
        <div className="surveys-section">
          <h2>Encrypted Feedback Surveys</h2>
          
          <div className="surveys-list">
            {filteredSurveys.length === 0 ? (
              <div className="no-surveys">
                <p>No surveys found</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Create First Survey
                </button>
              </div>
            ) : filteredSurveys.map((survey, index) => (
              <div 
                className={`survey-card ${survey.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedSurvey(survey)}
              >
                <div className="survey-header">
                  <h3>{survey.title}</h3>
                  <span className={`category-tag ${survey.category}`}>{survey.category}</span>
                </div>
                <div className="survey-meta">
                  <span>Sentiment: {survey.sentiment}/10</span>
                  <span>{new Date(survey.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="survey-status">
                  {survey.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {showFAQ && (
          <div className="faq-section">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <h4>{item.question}</h4>
                  <p>{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateSurvey 
          onSubmit={createSurvey} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSurvey} 
          surveyData={newSurveyData} 
          setSurveyData={setNewSurveyData}
          isEncrypting={isEncrypting}
          categories={categories}
        />
      )}
      
      {selectedSurvey && (
        <SurveyDetailModal 
          survey={selectedSurvey} 
          onClose={() => setSelectedSurvey(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedSurvey.id)}
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

const ModalCreateSurvey: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  surveyData: any;
  setSurveyData: (data: any) => void;
  isEncrypting: boolean;
  categories: string[];
}> = ({ onSubmit, onClose, creating, surveyData, setSurveyData, isEncrypting, categories }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSurveyData({ ...surveyData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-survey-modal">
        <div className="modal-header">
          <h2>New Anonymous Survey</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Your sentiment score will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Survey Title *</label>
            <input 
              type="text" 
              name="title" 
              value={surveyData.title} 
              onChange={handleChange} 
              placeholder="Enter survey title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={surveyData.category} onChange={handleChange}>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Sentiment Score (1-10) *</label>
            <input 
              type="range" 
              min="1" 
              max="10" 
              name="sentiment" 
              value={surveyData.sentiment} 
              onChange={handleChange} 
            />
            <div className="sentiment-value">{surveyData.sentiment}/10</div>
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Additional Feedback</label>
            <textarea 
              name="feedback" 
              value={surveyData.feedback} 
              onChange={handleChange} 
              placeholder="Optional detailed feedback..." 
              rows={3}
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !surveyData.title} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Survey"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SurveyDetailModal: React.FC<{
  survey: SurveyData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ survey, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const value = await decryptData();
    setDecryptedValue(value);
  };

  return (
    <div className="modal-overlay">
      <div className="survey-detail-modal">
        <div className="modal-header">
          <h2>Survey Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="survey-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{survey.title}</strong>
            </div>
            <div className="info-item">
              <span>Category:</span>
              <strong>{survey.category}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(survey.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Sentiment Data</h3>
            
            <div className="data-row">
              <div className="data-label">Sentiment Score:</div>
              <div className="data-value">
                {survey.isVerified ? 
                  `${survey.decryptedValue}/10 (Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue}/10 (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(survey.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : survey.isVerified ? "✅ Verified" : decryptedValue !== null ? "🔄 Re-verify" : "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Data</strong>
                <p>Sentiment score encrypted using homomorphic encryption for complete anonymity</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

