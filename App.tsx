
import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, Wand2, Download, RefreshCw, Camera, Sparkles, ArrowRight, Layers, UserX, Check, ArrowLeft, Eraser, Paintbrush, BoxSelect, Aperture, ChevronRight } from 'lucide-react';
import { generateEditedImage, replaceObject } from './services/geminiService';
import { AppStep, GeneratedImage, ImageState, Suggestion } from './types';
import { Spinner } from './components/Spinner';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.HOME);
  const [imageState, setImageState] = useState<ImageState>({ original: null, mimeType: '' });
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  
  // Masking State
  const [brushSize, setBrushSize] = useState(30);
  const isDrawingRef = useRef(false); // Use Ref for drawing state to avoid re-renders during draw loop
  const [maskData, setMaskData] = useState<string | null>(null); 
  const [customReplacePrompt, setCustomReplacePrompt] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null); 
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);

  const MODES: Suggestion[] = [
    {
      title: "Clean Studio Backdrop",
      description: "Keep the subject exactly as is (pose, position, clothing). Do NOT change the subject. Replace the background with a clean, professional studio wall that matches the original lighting intensity and shadows."
    },
    {
      title: "Replace Object",
      description: "Select specific objects in your photo to replace with new props, furniture, or elements using AI inpainting."
    }
  ];

  // Handle File Upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      const matches = base64String.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        const data = matches[2];
        
        setImageState({ original: data, mimeType });
        
        if (selectedSuggestion?.title === "Replace Object") {
            setStep(AppStep.MASKING);
        } else if (selectedSuggestion) {
            triggerGeneration(data, mimeType, selectedSuggestion);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleModeSelect = (mode: Suggestion) => {
      setSelectedSuggestion(mode);
      setStep(AppStep.UPLOAD);
  };

  const triggerGeneration = async (base64: string, mimeType: string, style: Suggestion) => {
    setStep(AppStep.GENERATING);
    setResults([]);

    try {
      const promises = Array(4).fill(null).map((_, index) => 
        generateEditedImage(base64, mimeType, style)
          .then(data => ({ id: `gen-${Date.now()}-${index}`, data }))
      );

      const images = await Promise.all(promises);
      setResults(images);
      setStep(AppStep.RESULTS);
    } catch (e) {
      console.error(e);
      setError("Failed to generate edits. Please try again.");
      setStep(AppStep.UPLOAD); 
    }
  };

  const handleImageSelect = (img: GeneratedImage) => {
    setSelectedImage(img);
    setStep(AppStep.DETAIL_VIEW);
  };

  const handleRemoveSubject = async () => {
    if (!selectedImage) return;
    
    setIsRefining(true);
    try {
      const removeSubjectStyle: Suggestion = {
        title: "Remove Subject",
        description: "Remove the main subject/person from the image. CRITICAL: Preserve the cast shadows and lighting traces on the floor/wall. Do not remove the shadow. The result should look like the person disappeared but their shadow remains."
      };

      const newImageData = await generateEditedImage(selectedImage.data, "image/png", removeSubjectStyle);
      
      setSelectedImage({
        id: `refined-${Date.now()}`,
        data: newImageData
      });
    } catch (e) {
      console.error(e);
      setError("Failed to remove subject.");
    } finally {
      setIsRefining(false);
    }
  };

  // --- Optimized Masking Logic ---

  const initMasking = () => {
     if (step === AppStep.MASKING && backgroundCanvasRef.current && drawCanvasRef.current && imageState.original) {
        const bgCanvas = backgroundCanvasRef.current;
        const bgCtx = bgCanvas.getContext('2d');
        const drawCanvas = drawCanvasRef.current;
        const drawCtx = drawCanvas.getContext('2d');
        
        const img = new Image();
        img.src = `data:${imageState.mimeType};base64,${imageState.original}`;
        img.onload = () => {
            bgCanvas.width = img.width;
            bgCanvas.height = img.height;
            drawCanvas.width = img.width;
            drawCanvas.height = img.height;
            
            if (bgCtx) bgCtx.drawImage(img, 0, 0);
            if (drawCtx) {
                drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
                // Initialize context properties once
                drawCtx.lineCap = 'round';
                drawCtx.lineJoin = 'round';
                drawCtx.strokeStyle = 'rgba(255, 0, 0, 0.5)'; 
                drawCtx.lineWidth = brushSize; 
            }
        };
     }
  };
  
  useEffect(initMasking, [step, imageState.original]);

  // Update brush size without re-initializing everything
  useEffect(() => {
    if (drawCanvasRef.current) {
        const ctx = drawCanvasRef.current.getContext('2d');
        if (ctx) {
            // We need to account for canvas scaling if we were doing that, 
            // but here we simply set it. 
            // Note: The drawOnLayer function handles scaling coordinates, 
            // but lineWidth corresponds to internal canvas pixels.
            // If the displayed size matches the internal size, this is direct.
            // Otherwise we might need a scale factor.
            // For simplicity here, we assume we want the brush size relative to the image resolution 
            // or we adjust it dynamically.
            // Let's just set it here.
            ctx.lineWidth = brushSize; 
        }
    }
  }, [brushSize]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // Prevent scrolling
    isDrawingRef.current = true;
    
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const { x, y } = getCoordinates(e, canvas);
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y); // Draw a dot
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    ctx?.beginPath(); // Reset path
  };

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
      const rect = canvas.getBoundingClientRect();
      let clientX, clientY;

      if ('touches' in e) {
         clientX = e.touches[0].clientX;
         clientY = e.touches[0].clientY;
      } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
      }

      // Calculate scale in case canvas is displayed at different size than its resolution
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY
      };
  };

  const drawOnLayer = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawingRef.current || !drawCanvasRef.current) return;

    const canvas = drawCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e, canvas);
    
    // Optimization: Context styles are set in useEffect/init, not here.
    // We simply draw line to new position.
    ctx.lineTo(x, y);
    ctx.stroke();
    
    // We do NOT call beginPath/moveTo here for continuous lines.
    // This makes the line much smoother.
  };

  const generateMaskAndProceed = () => {
      if (!drawCanvasRef.current) return;
      
      const sourceCanvas = drawCanvasRef.current;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = sourceCanvas.width;
      tempCanvas.height = sourceCanvas.height;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return;
      
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(sourceCanvas, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const data = imageData.data;
      for(let i=0; i < data.length; i+=4) {
          if (data[i] > 0 || data[i+1] > 0 || data[i+2] > 0) {
              data[i] = 255;
              data[i+1] = 255;
              data[i+2] = 255;
              data[i+3] = 255;
          }
      }
      ctx.putImageData(imageData, 0, 0);
      
      const maskBase64 = tempCanvas.toDataURL('image/png').split(',')[1];
      setMaskData(maskBase64);
      setStep(AppStep.REPLACE_OPTIONS);
  };

  const executeReplacement = async (promptText: string) => {
      if (!imageState.original || !maskData) return;
      
      setStep(AppStep.GENERATING);
      setResults([]);
      
      try {
          const promises = Array(4).fill(null).map((_, index) => 
            replaceObject(imageState.original!, maskData, promptText)
                .then(data => ({ id: `rep-${Date.now()}-${index}`, data }))
          );

          const images = await Promise.all(promises);
          setResults(images);
          setStep(AppStep.RESULTS);
      } catch (e) {
          console.error(e);
          setError("Failed to replace object.");
          setStep(AppStep.REPLACE_OPTIONS);
      }
  };

  const handleReset = () => {
    setStep(AppStep.HOME);
    setImageState({ original: null, mimeType: '' });
    setResults([]);
    setSelectedSuggestion(null);
    setSelectedImage(null);
    setError(null);
    setIsRefining(false);
    setMaskData(null);
    setCustomReplacePrompt("");
  };

  const downloadImage = (base64: string) => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${base64}`;
    link.download = `eran-studio-edit-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Render Components ---

  const renderHeader = () => (
    <header className="w-full p-6 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
      <div 
        className="flex items-center gap-2 cursor-pointer" 
        onClick={() => setStep(AppStep.HOME)}
      >
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
          <Camera className="w-5 h-5 text-black" />
        </div>
        <h1 className="text-xl font-bold text-white tracking-tight">
          Eran Photo Studio
        </h1>
      </div>
      {step !== AppStep.HOME && (
        <button 
          onClick={handleReset}
          className="text-sm text-zinc-400 hover:text-white flex items-center gap-2 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Restart
        </button>
      )}
    </header>
  );

  const renderHome = () => (
    <div className="flex-1 flex flex-col relative animate-fade-in overflow-hidden">
        <div className="absolute inset-0 z-0">
            <img 
            src="https://images.unsplash.com/photo-1542038784456-1ea8e935640e?q=80&w=2670&auto=format&fit=crop" 
            alt="Studio Background" 
            className="w-full h-full object-cover opacity-30 scale-105 animate-[pulse_10s_infinite]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-transparent"></div>
        </div>
        
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8">
            <div className="max-w-5xl w-full text-center space-y-8">
                <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500 tracking-tighter drop-shadow-2xl">
                    Eran Photo Studio
                </h1>
                <p className="text-2xl text-zinc-300 font-light tracking-wide">
                    Professional AI Photography Suite
                </p>
                <div className="pt-8">
                    <button 
                        onClick={() => setStep(AppStep.WORKFLOW_SELECT)}
                        className="group relative px-8 py-4 bg-white text-black text-lg font-bold rounded-full overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]"
                    >
                        <span className="relative z-10 flex items-center gap-2">
                            Enter Studio <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </span>
                        <div className="absolute inset-0 bg-zinc-200 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                    </button>
                </div>
            </div>
        </div>
        <div className="relative z-10 p-6 text-center text-zinc-600 text-sm">
            Powered by Gemini 2.5 Flash Image
        </div>
    </div>
  );

  const renderWorkflowSelect = () => (
      <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fade-in bg-zinc-950">
          <div className="max-w-4xl w-full space-y-10">
              <div className="text-center space-y-2">
                  <h2 className="text-4xl font-bold text-white">Select Workflow</h2>
                  <p className="text-zinc-400">Choose how you want to edit your photography.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Card 1 */}
                    <button 
                        onClick={() => handleModeSelect(MODES[0])}
                        className="group flex flex-col bg-zinc-900 border border-zinc-800 rounded-3xl p-1 transition-all hover:border-blue-500/50 hover:bg-zinc-900/80"
                    >
                        <div className="h-48 w-full bg-zinc-950 rounded-t-[20px] rounded-b-lg relative overflow-hidden flex items-center justify-center group-hover:bg-blue-950/20 transition-colors">
                            <Layers className="w-16 h-16 text-zinc-700 group-hover:text-blue-400 transition-colors duration-500" />
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent opacity-50"></div>
                        </div>
                        <div className="p-6 text-left space-y-2">
                            <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">Clean Studio Backdrop</h3>
                            <p className="text-sm text-zinc-400 leading-relaxed">
                                Automatically remove clutter and place your subject in a pristine studio environment.
                            </p>
                        </div>
                    </button>

                    {/* Card 2 */}
                    <button 
                        onClick={() => handleModeSelect(MODES[1])}
                        className="group flex flex-col bg-zinc-900 border border-zinc-800 rounded-3xl p-1 transition-all hover:border-purple-500/50 hover:bg-zinc-900/80"
                    >
                        <div className="h-48 w-full bg-zinc-950 rounded-t-[20px] rounded-b-lg relative overflow-hidden flex items-center justify-center group-hover:bg-purple-950/20 transition-colors">
                            <BoxSelect className="w-16 h-16 text-zinc-700 group-hover:text-purple-400 transition-colors duration-500" />
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent opacity-50"></div>
                        </div>
                        <div className="p-6 text-left space-y-2">
                            <h3 className="text-xl font-bold text-white group-hover:text-purple-400 transition-colors">Replace Object</h3>
                            <p className="text-sm text-zinc-400 leading-relaxed">
                                Use AI to paint over objects and replace them with props, furniture, or new elements.
                            </p>
                        </div>
                    </button>
              </div>
              
              <div className="flex justify-center">
                  <button onClick={() => setStep(AppStep.HOME)} className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-2">
                      <ArrowLeft className="w-4 h-4" /> Back to Entrance
                  </button>
              </div>
          </div>
      </div>
  );

  const renderUpload = () => (
    <div className="flex flex-col items-center justify-center flex-1 p-8 animate-fade-in">
      <button 
         onClick={() => setStep(AppStep.WORKFLOW_SELECT)}
         className="absolute top-24 left-8 flex items-center gap-2 text-zinc-500 hover:text-white transition-colors"
      >
         <ArrowLeft className="w-4 h-4" /> Change Workflow
      </button>

      <div className="max-w-xl w-full text-center space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs uppercase tracking-widest mb-4">
             Current Mode: {selectedSuggestion?.title}
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-white">Upload your photo</h2>
          <p className="text-zinc-400 text-lg">We'll apply your selected edit automatically.</p>
        </div>

        <div 
          className="relative group cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-500 to-white rounded-2xl blur opacity-20 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative w-full h-64 bg-zinc-900 rounded-2xl border-2 border-dashed border-zinc-700 group-hover:border-zinc-500 flex flex-col items-center justify-center gap-4 transition-all">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Upload className="w-8 h-8 text-zinc-400 group-hover:text-white transition-colors" />
            </div>
            <div className="text-zinc-400 group-hover:text-zinc-200">
              <span className="font-medium">Click to upload</span> or drag and drop
            </div>
            <p className="text-xs text-zinc-500">JPG, PNG up to 10MB</p>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleFileUpload}
          />
        </div>
      </div>
    </div>
  );

  const renderGenerating = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center gap-6 max-w-md text-center">
        <Spinner className="w-12 h-12 text-white" />
        <div className="space-y-2">
          <h3 className="text-2xl font-bold text-white">Working Magic</h3>
          <p className="text-zinc-400">
            Applying <span className="text-white font-medium">{selectedSuggestion?.title}</span>.
            <br />
            Creating 4 distinct variations...
          </p>
        </div>
        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-4">
          <div className="h-full bg-white w-1/2 animate-[shimmer_1.5s_infinite_linear]"></div>
        </div>
      </div>
    </div>
  );

  const renderResults = () => (
    <div className="flex-1 flex flex-col p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Select Your Favorite</h2>
            <p className="text-zinc-400">Click on a variation to refine or save it.</p>
          </div>
          <button 
            onClick={handleReset}
            className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition text-sm font-medium"
          >
            Start Over
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {results.map((img, idx) => (
            <div 
              key={img.id} 
              onClick={() => handleImageSelect(img)}
              className="group relative bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-lg cursor-pointer hover:border-zinc-500 transition-all duration-300"
            >
              <div className="h-96 w-full bg-zinc-950 relative flex items-center justify-center p-4">
                <div className="absolute inset-0 pattern-grid opacity-5"></div>
                <img 
                  src={`data:image/png;base64,${img.data}`} 
                  alt={`Result ${idx}`} 
                  className="max-w-full max-h-full object-contain shadow-xl"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="bg-white text-black px-6 py-3 rounded-full font-bold flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 shadow-2xl">
                    Select Variation <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
              <div className="p-4 flex items-center justify-between border-t border-zinc-800 bg-zinc-900">
                 <span className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <Aperture className="w-4 h-4" /> Variation #{idx + 1}
                 </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMasking = () => (
    <div className="flex-1 flex flex-col h-[calc(100vh-80px)] bg-zinc-950">
      <div className="h-16 border-b border-zinc-800 px-8 flex items-center justify-between bg-zinc-900">
        <button 
          onClick={() => setStep(AppStep.UPLOAD)}
          className="flex items-center gap-2 text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h2 className="text-white font-medium">Paint over the object to replace</h2>
        <button 
          onClick={generateMaskAndProceed}
          className="px-4 py-2 bg-white text-black rounded-full text-sm font-bold hover:bg-zinc-200 transition-colors"
        >
          Next: Choose Object
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center bg-zinc-950 overflow-hidden touch-none cursor-crosshair">
          <div className="relative shadow-2xl">
             {/* Background Image Canvas */}
             <canvas 
               ref={backgroundCanvasRef}
               className="max-h-[75vh] max-w-full object-contain pointer-events-none"
             />
             {/* Drawing Canvas Layer */}
             <canvas 
               ref={drawCanvasRef}
               className="absolute inset-0 w-full h-full touch-none"
               onMouseDown={(e) => {
                   startDrawing(e);
                   drawOnLayer(e);
               }}
               onMouseMove={drawOnLayer}
               onMouseUp={stopDrawing}
               onMouseLeave={stopDrawing}
               onTouchStart={(e) => {
                   startDrawing(e);
                   drawOnLayer(e);
               }}
               onTouchMove={drawOnLayer}
               onTouchEnd={stopDrawing}
             />
          </div>
      </div>
      
      {/* Toolbar */}
      <div className="h-20 bg-zinc-900 border-t border-zinc-800 flex items-center justify-center gap-8">
         <div className="flex items-center gap-4">
           <span className="text-xs text-zinc-500 uppercase font-medium tracking-wider">Brush Size</span>
           <input 
             type="range" 
             min="5" 
             max="100" 
             value={brushSize} 
             onChange={(e) => setBrushSize(Number(e.target.value))}
             className="w-32 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white"
           />
         </div>
         <button 
           onClick={initMasking} 
           className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700"
         >
            <Eraser className="w-4 h-4" /> Clear Mask
         </button>
      </div>
    </div>
  );

  const renderReplaceOptions = () => {
      const studioOptions = [
          "Vintage Film Camera",
          "Glass Vase with Lilies",
          "Antique Wooden Stool",
          "Professional Studio Softbox",
          "Abstract Marble Sculpture",
          "Pile of Old Books"
      ];

      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fade-in">
            <div className="max-w-2xl w-full space-y-8">
                <div className="text-center space-y-2">
                    <h2 className="text-3xl font-bold text-white">What should go there?</h2>
                    <p className="text-zinc-400">Select a studio prop or describe your own object.</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {studioOptions.map((opt) => (
                        <button
                           key={opt}
                           onClick={() => executeReplacement(opt)}
                           className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-300 hover:text-white hover:border-zinc-600 hover:bg-zinc-800 transition-all text-sm font-medium"
                        >
                            {opt}
                        </button>
                    ))}
                </div>

                <div className="relative">
                   <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-zinc-800"></div>
                   </div>
                   <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-zinc-950 text-zinc-500">or describe it</span>
                   </div>
                </div>

                <div className="flex gap-2">
                    <input 
                       type="text" 
                       value={customReplacePrompt}
                       onChange={(e) => setCustomReplacePrompt(e.target.value)}
                       placeholder="e.g. A futuristic neon helmet..."
                       className="flex-1 bg-zinc-900 border border-zinc-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-white focus:ring-1 focus:ring-white placeholder-zinc-600"
                       onKeyDown={(e) => e.key === 'Enter' && customReplacePrompt && executeReplacement(customReplacePrompt)}
                    />
                    <button 
                       onClick={() => customReplacePrompt && executeReplacement(customReplacePrompt)}
                       disabled={!customReplacePrompt}
                       className="px-6 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Generate
                    </button>
                </div>
                
                <button 
                    onClick={() => setStep(AppStep.MASKING)}
                    className="w-full text-zinc-500 text-sm hover:text-zinc-300"
                >
                    Cancel and re-mask
                </button>
            </div>
        </div>
      );
  };

  const renderDetailView = () => (
    <div className="flex-1 flex flex-col h-[calc(100vh-80px)]">
      <div className="h-16 border-b border-zinc-800 bg-zinc-900 px-8 flex items-center justify-between">
        <button 
          onClick={() => setStep(AppStep.RESULTS)}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Variations
        </button>
        <div className="text-white font-medium">
          Editing Selection
        </div>
        <div className="w-24"></div> 
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 bg-zinc-950 flex items-center justify-center p-8 relative">
           {selectedImage && (
             <div className="relative max-w-full max-h-full">
                <img 
                  src={`data:image/png;base64,${selectedImage.data}`} 
                  alt="Selected" 
                  className={`max-h-[75vh] w-auto rounded-lg shadow-2xl border border-zinc-800 transition-opacity duration-300 ${isRefining ? 'opacity-50 blur-sm' : 'opacity-100'}`}
                />
                {isRefining && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="bg-black/50 backdrop-blur-sm p-6 rounded-2xl flex flex-col items-center gap-4">
                       <Spinner className="w-12 h-12 text-white drop-shadow-lg" />
                       <p className="text-white font-medium">Processing Edit...</p>
                    </div>
                  </div>
                )}
             </div>
           )}
        </div>

        <div className="w-full lg:w-96 bg-zinc-900 border-l border-zinc-800 p-8 flex flex-col gap-8 overflow-y-auto">
           <div>
             <h2 className="text-2xl font-bold text-white mb-2">Final Touches</h2>
             <p className="text-zinc-400">Refine your selected photo or save it now.</p>
           </div>

           <div className="space-y-4">
             <button 
                onClick={() => selectedImage && downloadImage(selectedImage.data)}
                className="w-full py-4 bg-white text-black rounded-xl font-bold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
                disabled={isRefining}
             >
               <Download className="w-5 h-5" /> Save Image
             </button>

             <div className="h-px bg-zinc-800 my-4"></div>

             <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">Editing Tools</h3>
             
             <button 
               onClick={handleRemoveSubject}
               disabled={isRefining}
               className="w-full py-4 bg-zinc-800 text-zinc-200 rounded-xl font-medium hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-600 disabled:opacity-50"
             >
               <UserX className="w-5 h-5" /> Remove Subject
             </button>
             <p className="text-xs text-zinc-500 text-center">
               Remove subject keeps the background.
             </p>
           </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col">
      {renderHeader()}
      
      <main className="flex-1 flex flex-col relative">
        {error && (
           <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-full text-sm flex items-center gap-2 animate-fade-in shadow-xl backdrop-blur-md">
             <span>!</span> {error}
           </div>
        )}

        {step === AppStep.HOME && renderHome()}
        {step === AppStep.WORKFLOW_SELECT && renderWorkflowSelect()}
        {step === AppStep.UPLOAD && renderUpload()}
        {step === AppStep.GENERATING && renderGenerating()}
        {step === AppStep.RESULTS && renderResults()}
        {step === AppStep.DETAIL_VIEW && renderDetailView()}
        {step === AppStep.MASKING && renderMasking()}
        {step === AppStep.REPLACE_OPTIONS && renderReplaceOptions()}
      </main>

      <style>{`
        @keyframes spin-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        .animate-spin-reverse {
          animation: spin-reverse 3s linear infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .pattern-grid {
            background-image: radial-gradient(#3f3f46 1px, transparent 1px);
            background-size: 20px 20px;
        }
      `}</style>
    </div>
  );
};

export default App;
