#pragma once
#include "CoreMinimal.h"

class UCanvas;
class UTextureRenderTarget2D;

// Draw the already sRGB-encoded reference target onto the SDR demo canvas.
// Ordinary canvas texture drawing applies another gamma conversion.
AUTOVRUNTIME_API void DrawAutoVReference(UCanvas* Canvas, UTextureRenderTarget2D* Texture,
    const FVector2D& Position, const FVector2D& Size);
