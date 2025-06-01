# Image Generation

Ensemble provides a unified interface for generating images using OpenAI's DALL-E and Google's Imagen models.

## Basic Usage

```typescript
import { image } from '@just-every/ensemble';

// Simple image generation
const result = await image('A beautiful sunset over mountains');
console.log(`Generated ${result.images.length} image(s)`);

// Images are returned as base64 data URLs or URLs
result.images.forEach((img, i) => {
  console.log(`Image ${i + 1}: ${img.substring(0, 50)}...`);
});
```

## Supported Models

### OpenAI Models
- **gpt-image-1**: Latest OpenAI image generation model (default), supports image editing and variations
- **dall-e-3**: High quality model with best instruction following
- **dall-e-2**: Previous generation, supports image editing and variations

### Google Models
- **imagen-3.0-generate-002**: Latest Imagen model
- **imagen-2**: Previous generation

## Options

```typescript
interface ImageGenerationOpts {
  // Number of images to generate (default: 1)
  n?: number;
  
  // Size/aspect ratio of the generated image
  size?: 'square' | 'landscape' | 'portrait' | 
         '1024x1024' | '1536x1024' | '1024x1536' | // GPT-Image-1, DALL-E 3
         '1792x1024' | '1024x1792' | // DALL-E 3 only
         '512x512' | '256x256'; // DALL-E 2 only
  
  // Quality of the generated image
  quality?: 'standard' | 'hd' | 'low' | 'medium' | 'high'; // GPT-Image-1 supports low/medium/high
  
  // Style of the generated image
  style?: 'vivid' | 'natural'; // DALL-E 3 only
  
  // Response format
  response_format?: 'url' | 'b64_json'; // Default: 'b64_json'
  
  // Model to use (if not specified, auto-selected)
  model?: string;
  
  // For image editing (GPT-Image-1 and DALL-E 2)
  source_images?: string | string[]; // URLs or base64
  mask?: string; // Mask for inpainting (base64)
}
```

## Image Generation Examples

### High Quality Generation

```typescript
const result = await image('A photorealistic portrait of a cyberpunk cat', {
  model: 'dall-e-3',
  quality: 'hd',
  style: 'vivid',
  size: 'portrait'
});
```

### Multiple Images

```typescript
const result = await image('Abstract geometric patterns', {
  n: 4,
  size: 'square'
});

console.log(`Generated ${result.images.length} images`);
```

### Different Aspect Ratios

```typescript
// Landscape
const landscape = await image('Wide mountain panorama', {
  size: 'landscape' // 1792x1024 for DALL-E 3
});

// Portrait
const portrait = await image('Full body character design', {
  size: 'portrait' // 1024x1792 for DALL-E 3
});
```

## Image Editing (GPT-Image-1 and DALL-E 2)

GPT-Image-1 and DALL-E 2 support editing existing images and creating variations.

### Basic Image Editing

```typescript
// Edit an existing image (default uses gpt-image-1)
const result = await image('Add a red hat to the person', {
  source_images: 'https://example.com/person.jpg'
});

// Using base64 image with specific model
const result = await image('Change the background to a beach', {
  model: 'gpt-image-1',
  source_images: 'data:image/png;base64,iVBORw0KGgo...'
});

// Using DALL-E 2 for editing
const result = await image('Add sunglasses', {
  model: 'dall-e-2',
  source_images: originalImage
});
```

### Inpainting with Mask

For precise edits, provide a mask where transparent areas indicate regions to modify:

```typescript
const result = await image('Replace with a golden retriever', {
  source_images: originalImage, // The base image
  mask: maskImage // PNG with transparent areas to edit
});

// Or specify model explicitly
const result = await image('Replace with a cat', {
  model: 'gpt-image-1',
  source_images: originalImage,
  mask: maskImage
});
```

### Creating Variations

```typescript
// Create variations of an existing image (default uses gpt-image-1)
const result = await image('', { // Empty prompt for variations
  source_images: originalImage,
  n: 3 // Generate 3 variations
});

// Or use DALL-E 2
const result = await image('', {
  model: 'dall-e-2',
  source_images: originalImage,
  n: 3
});
```

## Using Google Imagen

```typescript
// Imagen with specific aspect ratio
const result = await image('A serene Japanese garden', {
  model: 'imagen-3.0-generate-002',
  size: 'landscape' // Maps to 16:9 aspect ratio
});

// Multiple images with Imagen
const result = await image('Colorful abstract art', {
  model: 'imagen-3.0-generate-002',
  n: 4
});
```

## Response Format

```typescript
interface ImageGenerationResult {
  // Array of generated images (URLs or base64 data)
  images: string[];
  
  // Model used for generation
  model: string;
  
  // Usage/cost information
  usage?: {
    prompt_tokens?: number;
    total_cost?: number;
  };
}
```

## Working with Generated Images

### Saving to File (Node.js)

```typescript
import { writeFile } from 'fs/promises';
import { image } from '@just-every/ensemble';

const result = await image('A majestic eagle in flight');

// Save base64 images
for (let i = 0; i < result.images.length; i++) {
  const base64Data = result.images[i].replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  await writeFile(`eagle_${i + 1}.png`, buffer);
}
```

### Displaying in Browser

```typescript
const result = await image('Cute puppy', { response_format: 'url' });

// Display in img tag
document.getElementById('image').src = result.images[0];

// Or with base64
const result = await image('Cute kitten');
document.getElementById('image').src = result.images[0]; // data:image/png;base64,...
```

## Cost Tracking

Image generation costs are automatically tracked:

```typescript
import { costTracker } from '@just-every/ensemble';

const result = await image('Complex architectural design', {
  model: 'dall-e-3',
  quality: 'hd'
});

console.log(`Total cost: $${result.usage?.total_cost}`);

// Get overall usage
const usage = costTracker.getAllUsage();
console.log('Total image generation cost:', usage);
```

## Error Handling

```typescript
try {
  const result = await image('Generate an image', {
    model: 'dall-e-3',
    n: 5 // DALL-E 3 only supports n=1
  });
} catch (error) {
  if (error.message.includes('Invalid parameter')) {
    console.error('DALL-E 3 only supports generating 1 image at a time');
  }
}
```

## Best Practices

1. **Be Specific**: More detailed prompts generally produce better results
2. **Use Appropriate Models**: 
   - GPT-Image-1 (default) for the latest features, image editing, and variations
   - DALL-E 3 for best quality and instruction following (no editing support)
   - DALL-E 2 for legacy editing and variations
   - Imagen for different artistic styles
3. **Handle Costs**: HD/high quality images cost more than standard quality
4. **Image Editing**: Use GPT-Image-1 (default) or DALL-E 2 for editing tasks
5. **Aspect Ratios**: Choose appropriate sizes for your use case

## Model-Specific Features

### GPT-Image-1 (Default)
- Latest OpenAI image generation model
- Supports image editing and variations
- Multiple images per request
- Quality levels: low ($0.020), medium ($0.040), high ($0.080)
- Sizes: 1024x1024, 1536x1024, 1024x1536
- Inpainting with masks

### DALL-E 3
- Best instruction following
- Supports HD quality
- Natural vs Vivid styles
- Limited to 1 image per request
- No editing support

### DALL-E 2
- Supports image editing and variations
- Multiple images per request (up to 10)
- Smaller size options (256x256, 512x512)
- Inpainting with masks

### Imagen
- Different aspect ratios (1:1, 16:9, 9:16)
- Good for artistic styles
- Supports multiple images per request