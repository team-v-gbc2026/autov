using UnrealBuildTool;
public class AutoVRuntime : ModuleRules {
    public AutoVRuntime(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new [] { "Core", "CoreUObject", "Engine" });
        PrivateDependencyModuleNames.AddRange(new [] { "Projects", "Json", "RenderCore", "RHI", "ImageWrapper", "InputCore" });
    }
}
