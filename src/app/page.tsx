'use client';

import { useState } from 'react';
import styles from './page.module.css';
import { UploadCloud, FileText, FileImage, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function Home() {
  const deploymentUrl = 'https://your-project-name.vercel.app';
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    text: string;
    suggestions: { title: string; content: string }[];
  } | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    setError(null);
    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(selectedFile.type)) {
      setError('Please upload a valid PDF or Image file (PNG/JPEG).');
      return;
    }
    setFile(selectedFile);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to analyze content');
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.hero}>
        <div className={styles.heroContent}>
          <h1>Social Media <span className={styles.gradientText}>Content Analyzer</span></h1>
          <p>Upload your drafted posts (PDF or Image) and let our AI suggest powerful engagement improvements for maximum reach.</p>
        </div>
      </header>

      <section className={styles.deploymentSection}>
        <div className={styles.deploymentCard}>
          <span className={styles.deploymentLabel}>Deployed Vercel Link</span>
          <a href={deploymentUrl} target="_blank" rel="noreferrer" className={styles.deploymentLink}>
            {deploymentUrl}
          </a>
          <small>Replace this with your final live Vercel deployment URL.</small>
        </div>
      </section>

      <section className={styles.mainSection}>
        <div className={`glass-card ${styles.uploadCard}`}>
          <h2>Upload Document</h2>
          <p className={styles.subtitle}>Drag and drop or select a file to analyze</p>
          
          <div 
            className={`${styles.dropZone} ${isDragging ? styles.dragging : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('fileUpload')?.click()}
          >
            <input 
              type="file" 
              id="fileUpload" 
              className={styles.hiddenInput} 
              accept=".pdf,image/png,image/jpeg,image/jpg"
              onChange={handleFileChange}
            />
            {file ? (
              <div className={styles.fileSelected}>
                {file.type === 'application/pdf' ? <FileText size={48} className={styles.fileIcon} /> : <FileImage size={48} className={styles.fileIcon} />}
                <p>{file.name}</p>
                <span className={styles.fileSize}>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            ) : (
              <div className={styles.uploadPrompt}>
                <UploadCloud size={48} className={styles.uploadIcon} />
                <p><strong>Click to upload</strong> or drag and drop</p>
                <span>PDF, PNG, JPG (Max 5MB)</span>
              </div>
            )}
          </div>

          {error && (
            <div className={styles.errorAlert}>
              <AlertCircle size={20} />
              <p>{error}</p>
            </div>
          )}

          <button 
            className={`button-primary ${styles.analyzeBtn}`} 
            disabled={!file || loading}
            onClick={handleAnalyze}
          >
            {loading ? (
              <span className={styles.loader}></span>
            ) : (
              <>
                <Sparkles size={20} />
                Analyze Content
              </>
            )}
          </button>
        </div>

        {result && (
          <div className={`glass-card ${styles.resultCard}`}>
            <div className={styles.resultHeader}>
              <CheckCircle2 size={24} className={styles.successIcon} />
              <h2>Analysis Complete</h2>
            </div>
            
            <div className={styles.resultGrid}>
              <div className={styles.extractedText}>
                <h3>Extracted Text</h3>
                <div className={styles.textContent}>
                  {result.text}
                </div>
              </div>
              
              <div className={styles.aiSuggestions}>
                <h3>Engagement Improvements</h3>
                <div className={styles.suggestionsList}>
                  {result.suggestions.map((suggestion, index) => (
                    <div key={index} className={styles.suggestionItem}>
                      <h4>{suggestion.title}</h4>
                      <p>{suggestion.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
