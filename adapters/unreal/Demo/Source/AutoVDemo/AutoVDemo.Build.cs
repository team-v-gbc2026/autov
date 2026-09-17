using UnrealBuildTool;
public class AutoVDemo : ModuleRules {
    public AutoVDemo(ReadOnlyTargetRules Target) : base(Target) { PCHUsage=PCHUsageMode.UseExplicitOrSharedPCHs; PublicDependencyModuleNames.AddRange(new [] {"Core","CoreUObject","Engine","InputCore","AutoVRuntime"}); }
}
