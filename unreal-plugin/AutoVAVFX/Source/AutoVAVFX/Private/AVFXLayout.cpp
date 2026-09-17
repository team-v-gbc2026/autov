#include "AVFXLayout.h"
bool GetAVFXLayout(const FString& Program, FAVFXLayout& Layout)
{
    Layout = FAVFXLayout();
    #include "Generated/Layout.inl"
}
FMatrix AVFXSourceToUnreal()
{
    return FMatrix(FPlane(0,100,0,0), FPlane(0,0,100,0), FPlane(100,0,0,0), FPlane(0,0,0,1));
}
