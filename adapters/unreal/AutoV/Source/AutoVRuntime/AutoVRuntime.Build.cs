using UnrealBuildTool;
public class AutoVRuntime : ModuleRules {
    public AutoVRuntime(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new [] { "Core", "CoreUObject", "Engine" });
        PrivateDependencyModuleNames.AddRange(new [] { "Projects", "Json", "RenderCore", "Renderer", "RHI", "ImageWrapper", "InputCore" });
        PrivateIncludePaths.Add(System.IO.Path.Combine(EngineDirectory,"Source/Runtime/Renderer/Private"));
        PrivateIncludePaths.Add(System.IO.Path.Combine(EngineDirectory,"Source/Runtime/Renderer/Internal"));
    }
}
