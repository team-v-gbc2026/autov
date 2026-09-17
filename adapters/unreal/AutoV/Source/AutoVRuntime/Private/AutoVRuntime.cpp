#include "Modules/ModuleManager.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/Paths.h"
#include "ShaderCore.h"
class FAutoVRuntimeModule : public IModuleInterface {
public:
    virtual void StartupModule() override { AddShaderSourceDirectoryMapping(TEXT("/Plugin/AutoV"),FPaths::Combine(IPluginManager::Get().FindPlugin(TEXT("AutoV"))->GetBaseDir(),TEXT("Shaders"))); }
};
IMPLEMENT_MODULE(FAutoVRuntimeModule,AutoVRuntime)
