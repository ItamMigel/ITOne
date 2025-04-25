import os
import io
import base64
from typing import Dict, List, Optional, Union, Any
import numpy as np
from PIL import Image
import fitz  # PyMuPDF for PDF handling
import pytesseract
import torch
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class OCRService:
    """Service for performing OCR on images and PDFs using multiple backends with fallbacks."""
    
    def __init__(self, use_transformers: bool = True, tesseract_cmd: Optional[str] = None):
        """
        Initialize the OCR service with fallback options.
        
        Args:
            use_transformers: Whether to use the Transformer-based OCR model (TrOCR)
            tesseract_cmd: Path to tesseract executable if needed (optional)
        """
        self.use_tesseract = False
        self.use_transformers = False
        
        # Setup Tesseract if available
        try:
            if tesseract_cmd:
                pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
            # Quick test to see if Tesseract is available
            pytesseract.get_tesseract_version()
            self.use_tesseract = True
            logger.info("Tesseract OCR is available")
        except Exception as e:
            logger.warning(f"Tesseract OCR is not available: {str(e)}")
        
        # Initialize TrOCR if requested
        if use_transformers:
            try:
                logger.info("Loading TrOCR model...")
                self.processor = TrOCRProcessor.from_pretrained("microsoft/trocr-base-printed")
                self.model = VisionEncoderDecoderModel.from_pretrained("microsoft/trocr-base-printed")
                
                # Move to GPU if available
                if torch.cuda.is_available():
                    self.model.to("cuda")
                    logger.info("TrOCR model loaded on GPU")
                else:
                    logger.info("TrOCR model loaded on CPU")
                
                self.use_transformers = True
            except Exception as e:
                logger.warning(f"Failed to load TrOCR model: {str(e)}")
        
        # Check if we have at least one OCR method available
        if not self.use_tesseract and not self.use_transformers:
            logger.warning("No OCR method is available. Text extraction may be limited.")
    
    def extract_text(self, file_bytes: Optional[bytes] = None, file_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Extract text from various file types.
        
        Args:
            file_bytes: File as bytes
            file_type: Type of file ('pdf', 'image', or auto-detect)
            
        Returns:
            Dictionary with extracted text and metadata
        """
        if not file_bytes:
            raise ValueError("file_bytes must be provided")
        
        # Determine file type if not specified
        if not file_type:
            # Try to detect from bytes (simple magic bytes check)
            if file_bytes[:4] == b'%PDF':
                file_type = 'pdf'
            else:
                try:
                    # Try to open as image
                    Image.open(io.BytesIO(file_bytes))
                    file_type = 'image'
                except:
                    file_type = 'unknown'
        
        # Process based on file type
        if file_type == 'pdf':
            return self.process_pdf(file_bytes)
        elif file_type == 'image':
            text = self.process_image(file_bytes)
            return {"text": text, "pages": 1}
        else:
            # For unknown file types, try to extract text directly if possible
            return {"text": "File type not supported for text extraction", "pages": 0}
    
    def process_pdf(self, file_bytes: Optional[bytes] = None) -> Dict[str, Any]:
        """
        Extract text from a PDF file using PyMuPDF with OCR fallback.
        
        Args:
            file_bytes: PDF file as bytes
            
        Returns:
            Dictionary with extracted text and metadata
        """
        if not file_bytes:
            raise ValueError("file_bytes must be provided")
        
        try:
            # Open PDF document
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            
            results = []
            total_text = ""
            
            for page_num, page in enumerate(doc):
                # Try to extract text directly
                text = page.get_text()
                
                # If no text was extracted (scanned PDF), try OCR
                if not text.strip() and (self.use_tesseract or self.use_transformers):
                    try:
                        # Convert page to image
                        pix = page.get_pixmap(alpha=False)
                        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                        
                        # Process with OCR
                        text = self.process_image(img)
                    except Exception as e:
                        logger.error(f"OCR failed on page {page_num+1}: {str(e)}")
                
                results.append({
                    "page": page_num + 1,
                    "text": text
                })
                total_text += text + "\n\n"
            
            return {
                "pages": len(doc),
                "page_results": results,
                "text": total_text.strip()
            }
        
        except Exception as e:
            logger.error(f"Error processing PDF: {str(e)}")
            return {"text": f"Error processing PDF: {str(e)}", "pages": 0}
    
    def process_image(self, image: Union[str, bytes, Image.Image]) -> str:
        """
        Extract text from an image using OCR.
        
        Args:
            image: Path to image file, image bytes, or PIL Image object
            
        Returns:
            Extracted text
        """
        # Convert input to PIL Image if needed
        if isinstance(image, str):
            img = Image.open(image)
        elif isinstance(image, bytes):
            img = Image.open(io.BytesIO(image))
        elif isinstance(image, Image.Image):
            img = image
        else:
            raise ValueError("Image must be a file path, bytes, or PIL Image")
        
        # Try transformer-based OCR first if enabled
        if self.use_transformers:
            try:
                return self._process_with_trocr(img)
            except Exception as e:
                logger.warning(f"TrOCR failed, falling back to Tesseract: {str(e)}")
        
        # Try Tesseract if available
        if self.use_tesseract:
            try:
                return self._process_with_tesseract(img)
            except Exception as e:
                logger.error(f"Tesseract OCR failed: {str(e)}")
        
        # If all OCR methods failed or are unavailable
        return "Text extraction failed - no OCR method available"
    
    def _process_with_trocr(self, image: Image.Image) -> str:
        """Process image with TrOCR model."""
        # Ensure image is RGB
        if image.mode != "RGB":
            image = image.convert("RGB")
        
        # Preprocess image
        pixel_values = self.processor(image, return_tensors="pt").pixel_values
        if torch.cuda.is_available():
            pixel_values = pixel_values.to("cuda")
        
        # Generate text
        generated_ids = self.model.generate(pixel_values)
        generated_text = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        
        return generated_text
    
    def _process_with_tesseract(self, image: Image.Image) -> str:
        """Process image with Tesseract OCR."""
        # Ensure image is in a format Tesseract can handle
        if image.mode != "RGB":
            image = image.convert("RGB")
        
        # Extract text using Tesseract
        text = pytesseract.image_to_string(image)
        return text
    
    def process_base64_image(self, base64_string: str) -> str:
        """
        Extract text from a base64-encoded image.
        
        Args:
            base64_string: Base64-encoded image string
            
        Returns:
            Extracted text
        """
        # Decode base64 string
        if "base64," in base64_string:
            base64_string = base64_string.split("base64,")[1]
        
        image_bytes = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_bytes))
        
        return self.process_image(image)
