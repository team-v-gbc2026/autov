#include "Modules/ModuleManager.h"
#include "Interfaces/IPluginManager.h"
#include "ShaderCore.h"
#include "Misc/Paths.h"
class FAutoVAVFXModule : public IModuleInterface
{
public:
    virtual void StartupModule() override
    {
        AddShaderSourceDirectoryMapping(TEXT("/Plugin/AutoVAVFX"),FPaths::Combine(IPluginManager::Get().FindPlugin(TEXT("AutoVAVFX"))->GetBaseDir(),TEXT("Shaders")));
    }
};
IMPLEMENT_MODULE(FAutoVAVFXModule,AutoVAVFX)
